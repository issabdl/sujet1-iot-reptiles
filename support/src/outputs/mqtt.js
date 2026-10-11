'use strict';

const mqtt = require('mqtt');

// Adaptateur "mqtt" : une connexion MQTT par node (clientId = id du node)

const VERSION = 1;

// N-DES-01 -> DES, N-ROOM-TRO -> TRO, N-DOOR-MAIN -> BAT
function zoneOf(nodeId) {
  const parts = nodeId.split('-');
  if (parts[1] === 'ROOM') return parts[2];
  if (parts[1] === 'DOOR') return 'BAT';
  return parts[1];
}

function createMqttOutput({
  url = 'mqtt://localhost:1883',
  password = 'nodepass',
  root = 'reptiles',
  bufferMax = 5000,
  log = (msg) => process.stderr.write(`[mqtt] ${msg}\n`),
} = {}) {
  const links = new Map();
  let sim = null;
  let connectedCount = 0;
  let lastError = null;

  function route(base, m) {
    const { node, ts, seq, type, ...fields } = m;
    const head = { v: VERSION, node, seq, ts, rxTs: sim.now };
    switch (type) {
      case 'reading':
        return { topic: `${base}/reading/${m.sensor}`, body: { ...head, ...fields }, qos: 0, retain: true };
      case 'door':
        return { topic: `${base}/door`, body: { ...head, ...fields }, qos: 1, retain: true };
      case 'heartbeat':
        return { topic: `${base}/status`, body: { ...head, online: true, ...fields }, qos: 1, retain: true };
      case 'boot':
        return { topic: `${base}/event`, body: { ...head, event: 'boot', ...fields }, qos: 1, retain: false };
      case 'ack':
        return { topic: `${base}/ack`, body: { ...head, ...fields }, qos: 1, retain: false };
      default:
        return { topic: `${base}/event`, body: { ...head, event: type, ...fields }, qos: 1, retain: false };
    }
  }

  function send(link, topic, body, qos, retain) {
    const payload = JSON.stringify(body);
    if (link.client.connected) {
      link.client.publish(topic, payload, { qos, retain });
      return;
    }
    // tampon plein : on jette la plus vieille mesure en premier
    if (link.buffer.length >= bufferMax) {
      const i = link.buffer.findIndex((b) => b.qos === 0);
      link.buffer.splice(i >= 0 ? i : 0, 1);
    }
    link.buffer.push({ topic, payload, qos, retain });
  }

  function flush(link) {
    const pending = link.buffer;
    link.buffer = [];
    for (const b of pending) link.client.publish(b.topic, b.payload, { qos: b.qos, retain: b.retain });
    return pending.length;
  }

  function onCommand(nodeId, link, raw) {
    let cmd;
    try {
      cmd = JSON.parse(raw.toString());
    } catch {
      log(`${nodeId} : commande JSON invalide ignoree`);
      return;
    }
    if (cmd.v !== VERSION || !cmd.id || !cmd.action) {
      log(`${nodeId} : commande ignoree (version ou champs manquants)`);
      return;
    }
    // QoS 1 : une commande peut arriver deux fois
    if (link.seenCmds.includes(cmd.id)) return;
    link.seenCmds.push(cmd.id);
    if (link.seenCmds.length > 50) link.seenCmds.shift();

    const res = sim.handleCommand({ id: cmd.id, target: nodeId, action: cmd.action, value: cmd.value });
    if (res === null) log(`${nodeId} : commande ${cmd.id} sans reponse (node hors ligne)`);
  }

  function connectNode(nodeId) {
    const base = `${root}/${zoneOf(nodeId)}/${nodeId}`;
    const client = mqtt.connect(url, {
      clientId: nodeId,
      username: nodeId,
      password,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: 5000,
      will: {
        topic: `${base}/status`,
        payload: JSON.stringify({ v: VERSION, node: nodeId, online: false, reason: 'connection_lost' }),
        qos: 1,
        retain: true,
      },
    });
    const link = { client, base, buffer: [], seenCmds: [], connected: false, everConnected: false };
    links.set(nodeId, link);

    client.on('connect', () => {
      link.connected = true;
      connectedCount++;
      client.publish(`${base}/status`, JSON.stringify({ v: VERSION, node: nodeId, online: true, rxTs: sim.now }), { qos: 1, retain: true });
      client.subscribe(`${base}/cmd`, { qos: 1 });
      const n = flush(link);
      if (link.everConnected && n > 0) log(`${nodeId} reconnecte, ${n} messages du tampon republies`);
      link.everConnected = true;
      if (connectedCount === links.size) {
        log(`${links.size}/${links.size} nodes connectes a ${url}`);
        lastError = null;
      }
    });
    client.on('close', () => {
      if (!link.connected) return;
      link.connected = false;
      connectedCount--;
      if (connectedCount === 0) log('broker injoignable : messages mis en tampon, reconnexion automatique');
    });
    client.on('error', (err) => {
      const text = err.code || err.message;
      if (text !== lastError) log(`erreur : ${text}`);
      lastError = text;
    });
    client.on('message', (topic, raw) => onCommand(nodeId, link, raw));
  }

  return {
    start(s) {
      sim = s;
      for (const nodeId of sim.nodes.keys()) connectNode(nodeId);
      sim.on('message', (m) => {
        const link = links.get(m.node);
        if (!link) return;
        const r = route(link.base, m);
        send(link, r.topic, r.body, r.qos, r.retain);
      });
    },
    // le Last Will n'est pas envoye sur une deconnexion propre, on publie le status nous-memes
    stop() {
      const jobs = [...links.entries()].map(([nodeId, link]) => new Promise((resolve) => {
        if (!link.client.connected) return link.client.end(true, resolve);
        const payload = JSON.stringify({ v: VERSION, node: nodeId, online: false, reason: 'shutdown' });
        link.client.publish(`${link.base}/status`, payload, { qos: 1, retain: true }, () => link.client.end(false, resolve));
      }));
      return Promise.all(jobs);
    },
  };
}

module.exports = { createMqttOutput, zoneOf };
