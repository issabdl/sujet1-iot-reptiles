'use strict';

// Front : client MQTT over WebSocket dans le navigateur, alertes calculees ici

const A = CONFIG.alerts;
const ROOT = CONFIG.topicRoot;
const MIN = 60_000;

const nodes = new Map();
for (const def of CONFIG.nodes) {
  nodes.set(def.id, {
    ...def,
    prof: CONFIG.species[def.species] || null,
    lastSeen: null,
    online: null,
    status: {},
    readings: {},
    history: {},
    door: null,
    doorSince: null,
    skewS: null,
    period: null,
    streak: {},
    validRun: {},
  });
}

let client = null;
let simNow = 0; // heure simulee
let lastMsgT = 0;
let firstLive = null;
let selected = null;
let chart = null;
let dirty = true;

const alertList = [];
const activeAlerts = new Map();
let alertSeq = 0;
const commands = [];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtClock = new Intl.DateTimeFormat('fr-FR', { timeZone: CONFIG.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('fr-FR', { timeZone: CONFIG.timeZone, weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtParts = new Intl.DateTimeFormat('en-GB', { timeZone: CONFIG.timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });

const clock = (t) => (t ? fmtClock.format(t) : '--');
function hourOf(t) {
  const p = {};
  for (const x of fmtParts.formatToParts(t)) p[x.type] = x.value;
  return Number(p.hour) + Number(p.minute) / 60;
}
const fmtVal = (sensor, v) => (v === undefined ? '--' : sensor === 'light' ? `${Math.round(v)} lx` : `${Number(v).toFixed(1)} °C`);

function setCond(n, type, active, severity, text, sensor) {
  const key = `${n.id}|${type}|${sensor || ''}`;
  const a = activeAlerts.get(key);
  if (active && !a) {
    const alert = { id: ++alertSeq, key, node: n.id, type, severity, text, raisedAt: simNow || lastMsgT, clearedAt: null, ackedAt: null, active: true };
    alertList.unshift(alert);
    activeAlerts.set(key, alert);
    if (alertList.length > 500) alertList.pop();
  } else if (active && a) {
    a.text = text;
    a.severity = severity;
  } else if (!active && a) {
    a.active = false;
    a.clearedAt = simNow || lastMsgT;
    activeAlerts.delete(key);
  }
  dirty = true;
}

function raiseEvent(n, type, severity, text, t) {
  alertList.unshift({ id: ++alertSeq, key: null, node: n.id, type, severity, text, raisedAt: t, clearedAt: t, ackedAt: null, active: false });
  if (alertList.length > 500) alertList.pop();
  dirty = true;
}

// 2 mesures de suite pour lever l'alerte, hold = hysteresis pour la terminer
function setCondConfirmed(n, type, cond, severity, text, hold = cond) {
  if (activeAlerts.has(`${n.id}|${type}|`)) {
    setCond(n, type, hold, severity, text);
    if (!hold) n.streak[type] = 0;
    return;
  }
  n.streak[type] = cond ? (n.streak[type] || 0) + 1 : 0;
  setCond(n, type, n.streak[type] >= 2, severity, text);
}

function ackAlert(id) {
  const a = alertList.find((x) => x.id === id);
  if (a && !a.ackedAt) a.ackedAt = simNow || Date.now();
  dirty = true;
}

function worstSeverity(nodeId) {
  let worst = null;
  for (const a of activeAlerts.values()) {
    if (a.node !== nodeId) continue;
    if (a.type === 'mute' || a.type === 'offline') return 'mute';
    if (a.severity === 'critique') worst = 'crit';
    else if (a.severity === 'alerte' && worst !== 'crit') worst = 'warn';
  }
  return worst;
}

function onMessage(topic, payload, retained) {
  const parts = topic.split('/');
  const n = nodes.get(parts[2]);
  if (!n || parts[3] === 'cmd') return;
  let m;
  try {
    m = JSON.parse(payload.toString());
  } catch {
    return;
  }
  if (m.v !== 1) return;

  // un message retenu peut venir d'un ancien run du simulateur
  if (!retained && m.rxTs) {
    if (simNow && m.rxTs < simNow - 3 * 60 * MIN) resetAfterRestart();
    if (m.rxTs > simNow) simNow = m.rxTs;
    if (!firstLive) firstLive = simNow;
  }
  const t = m.rxTs || simNow;
  lastMsgT = t;

  switch (parts[3]) {
    case 'reading': onReading(n, parts[4], m, t, retained); break;
    case 'door': onDoor(n, m, t, retained); break;
    case 'status': onStatus(n, m, t, retained); break;
    case 'event': onEvent(n, m, t, retained); break;
    case 'ack': onAck(m); break;
  }
  dirty = true;
}

function touch(n, m, t) {
  n.lastSeen = t;
  if (typeof m.ts === 'number' && m.rxTs) {
    n.skewS = Math.round((m.ts - m.rxTs) / 1000);
    const bad = Math.abs(n.skewS) > A.clockSkewS;
    const why = m.ts < 1e12 ? 'non synchronisée (date 1970)' : `décalée de ${n.skewS} s`;
    setCond(n, 'clock', bad, 'info', `Horloge du node ${why}`);
  }
}

function onReading(n, sensor, m, t, retained) {
  const v = m.value;
  n.readings[sensor] = { value: v, t };
  if (retained) return;
  touch(n, m, t);

  const hist = (n.history[sensor] ||= []);
  hist.push({ x: t, y: v });
  while (hist.length && hist[0].x < t - (CONFIG.historyMinutes + 5) * MIN) hist.shift();

  const isTemp = sensor.startsWith('temp');
  const [lo, hi] = isTemp ? A.tempRange : A.lightRange;
  const aberrant = v < lo || v > hi;
  if (aberrant) {
    n.validRun[sensor] = 0;
    let text = `Valeur aberrante ${sensor} : ${v}`;
    if (v === -127) text = `Capteur ${sensor} muet / débranché (-127)`;
    if (v === 85) text = `Valeur aberrante ${sensor} : 85 °C (reset de la sonde)`;
    setCond(n, 'aberrant', true, 'alerte', text, sensor);
    return;
  }
  n.validRun[sensor] = (n.validRun[sensor] || 0) + 1;
  if (n.validRun[sensor] >= 10) setCond(n, 'aberrant', false, 'alerte', '', sensor);

  // seuils par espece
  const p = n.prof;
  if (n.kind !== 'enclosure' || !p || p.hotDay == null) return;
  const h = hourOf(t);
  const day = h >= p.photo[0] && h < p.photo[1];
  const warm = h >= p.photo[0] + A.warmupH && h < p.photo[1];
  if (sensor === 'temp_hot') {
    const max = p.hotDay + A.hotHighMargin;
    const min = p.hotDay - A.hotLowMargin;
    const hy = A.hysteresis;
    setCondConfirmed(n, 'hot_high', v > max, 'critique', `Surchauffe point chaud : ${v.toFixed(1)} °C (max ${max})`, v > max - hy);
    setCondConfirmed(n, 'hot_low', warm && v < min, 'alerte', `Point chaud trop froid : ${v.toFixed(1)} °C (min ${min}), lampe ?`, warm && v < min + hy);
  } else if (sensor === 'temp_cold') {
    const min = (day ? p.coldDay[0] : p.night[0]) - A.coldMargin;
    const max = p.coldDay[1] + A.coldHighMargin;
    const hy = A.hysteresis;
    setCondConfirmed(n, 'cold_low', v < min, 'alerte', `Point froid trop froid : ${v.toFixed(1)} °C (min ${min})`, v < min + hy);
    setCondConfirmed(n, 'cold_high', v > max, 'alerte', `Point froid trop chaud : ${v.toFixed(1)} °C (max ${max})`, v > max - hy);
  } else if (sensor === 'light') {
    const mid = h >= p.photo[0] + 1 && h < p.photo[1] - 1;
    const min = Math.round(p.luxDay * A.lightMinRatio);
    setCondConfirmed(n, 'light_low', mid && v < min, 'alerte', `Éclairage faible : ${Math.round(v)} lx (min ${min}), lampe ?`, mid && v < min * 1.2);
  }
}

function onDoor(n, m, t, retained) {
  if (!retained) touch(n, m, t);
  if (n.door !== m.state) {
    n.door = m.state;
    n.doorSince = t;
  }
  if (m.state !== 'open') {
    setCond(n, 'door_long', false);
    return;
  }
  const h = hourOf(t);
  if (!retained && (h < A.openHours[0] || h >= A.openHours[1])) {
    raiseEvent(n, 'after_hours', 'critique', `Ouverture hors horaires (${n.label})`, t);
  }
}

function onStatus(n, m, t, retained) {
  if (m.online === false) {
    n.online = false;
    const why = m.reason === 'shutdown' ? 'arrêté proprement' : 'connexion perdue (Last Will)';
    setCond(n, 'offline', true, 'critique', `Node déconnecté : ${why}`);
    return;
  }
  n.online = true;
  setCond(n, 'offline', false);
  if (m.uptimeS === undefined) return; // message de naissance
  n.status = m;
  if (!retained) touch(n, m, t);
  if (typeof m.battery === 'number') {
    const sev = m.battery < A.batteryCritical ? 'critique' : 'alerte';
    setCond(n, 'battery', m.battery < A.batteryLow, sev, `Pile faible : ${m.battery} %`);
  }
}

function onEvent(n, m, t, retained) {
  if (retained) return;
  touch(n, m, t);
  if (m.event === 'boot') raiseEvent(n, 'boot', 'info', `Redémarrage du node (${m.reason})`, t);
}

function resetAfterRestart() {
  simNow = 0;
  firstLive = null;
  for (const n of nodes.values()) {
    n.lastSeen = null;
    n.history = {};
    n.streak = {};
  }
}

function tick() {
  if (!simNow) return;
  for (const n of nodes.values()) {
    const ref = n.lastSeen || firstLive;
    let limit = A.muteMin[n.kind];
    if (n.period) limit = Math.max(limit, (3 * n.period) / 60);
    const age = (simNow - ref) / MIN;
    setCond(n, 'mute', age > limit, 'critique', `Node muet depuis ${Math.round(age)} min`);

    if (n.door === 'open' && n.doorSince) {
      const open = (simNow - n.doorSince) / MIN;
      setCond(n, 'door_long', open > A.doorOpenMaxMin[n.kind], 'critique', `Porte ouverte depuis ${Math.round(open)} min`);
    }
  }
}

function sendCommand(nodeId, action, value) {
  const n = nodes.get(nodeId);
  const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const c = { id, node: nodeId, action, value, sentAt: Date.now(), status: 'pending', detail: 'en attente de l\'ack' };
  commands.unshift(c);
  if (commands.length > 30) commands.pop();
  dirty = true;

  if (!client || !client.connected) {
    c.status = 'ko';
    c.detail = 'non envoyée : pas connecté au broker';
    return;
  }
  const cmd = { v: 1, id, action, ts: Date.now() };
  if (value !== undefined) cmd.value = value;
  client.publish(`${ROOT}/${n.zone}/${nodeId}/cmd`, JSON.stringify(cmd), { qos: 1 });
  c.timer = setTimeout(() => {
    if (c.status !== 'pending') return;
    c.status = 'timeout';
    c.detail = `sans réponse après ${CONFIG.commandTimeoutMs / 1000} s (node injoignable ?)`;
    dirty = true;
  }, CONFIG.commandTimeoutMs);
}

function onAck(m) {
  const c = commands.find((x) => x.id === m.cmdId);
  if (!c || c.status !== 'pending') return;
  clearTimeout(c.timer);
  c.latencyMs = Date.now() - c.sentAt;
  c.detail = m.detail;
  if (!m.ok) c.status = 'ko';
  else if (m.detail === 'applied_but_relay_feedback_on') {
    c.status = 'warn';
    c.detail = 'acceptée mais le relais reste collé : utiliser safety_cut';
  } else c.status = 'ok';
  if (m.ok && c.action === 'interval') nodes.get(c.node).period = Number(c.value);
}

function nodeState(n) {
  if (activeAlerts.has(`${n.id}|offline|`)) return ['off', 'déconnecté'];
  if (activeAlerts.has(`${n.id}|mute|`)) return ['mute', 'muet'];
  if (n.lastSeen) return ['ok', 'en ligne'];
  return ['mute', 'en attente'];
}

function renderOverview() {
  let html = '';
  for (const z of CONFIG.zones) {
    html += `<div class="zone"><h3>${esc(z.label)}</h3><div class="cards">`;
    for (const n of nodes.values()) {
      if (n.zone !== z.id) continue;
      const sev = worstSeverity(n.id) || '';
      const r = n.readings;
      let vals = '';
      if (n.kind === 'enclosure' || n.kind === 'outdoor') {
        vals = `chaud ${fmtVal('t', r.temp_hot?.value)} · froid ${fmtVal('t', r.temp_cold?.value)}<br>lumière ${fmtVal('light', r.light?.value)}`;
      } else if (n.kind === 'room') {
        vals = `ambiance ${fmtVal('t', r.temp_ambient?.value)}`;
      }
      const door = n.door === 'open' ? '<span class="door-open">porte OUVERTE</span>' : n.door === 'closed' ? 'porte fermée' : 'porte ?';
      const batt = typeof n.status.battery === 'number' ? ` · pile ${n.status.battery} %` : '';
      const sp = n.prof ? n.prof.label : n.label;
      html += `<div class="card ${sev} ${selected === n.id ? 'selected' : ''}" data-node="${n.id}">
        <div class="name">${esc(n.kind === 'door' || n.kind === 'room' ? n.label : n.id.slice(2))}</div>
        <div class="sp">${esc(n.kind === 'door' || n.kind === 'room' ? n.id : sp)}</div>
        <div class="vals">${vals}${vals ? '<br>' : ''}${door}${batt}</div></div>`;
    }
    html += '</div></div>';
  }
  $('overview').innerHTML = html;
}

function renderNodesTable() {
  let html = '<tr><th>Node</th><th>Zone</th><th>État</th><th>Dernier message</th><th>RSSI</th><th>Pile</th><th>Firmware</th><th>Uptime</th><th>Horloge</th></tr>';
  for (const n of nodes.values()) {
    const [cls, label] = nodeState(n);
    const age = n.lastSeen ? `${Math.round((simNow - n.lastSeen) / 1000)} s` : '--';
    const s = n.status;
    const up = s.uptimeS !== undefined ? `${(s.uptimeS / 86400).toFixed(1)} j` : '--';
    const skew = n.skewS === null ? '--' : Math.abs(n.skewS) > A.clockSkewS ? `<span class="st-off">${n.skewS} s</span>` : 'ok';
    html += `<tr><td>${n.id}</td><td>${n.zone}</td><td class="st-${cls}">${label}</td><td>${age}</td>
      <td>${s.rssi ?? '--'} dBm</td><td>${s.battery ?? '--'}${s.battery !== undefined ? ' %' : ''}</td><td>${esc(s.fw ?? '--')}</td><td>${up}</td><td>${skew}</td></tr>`;
  }
  $('nodes-table').innerHTML = html;
}

function renderAlerts() {
  const unacked = alertList.filter((a) => !a.ackedAt).length;
  $('alert-count').textContent = unacked;
  let html = '';
  for (const a of alertList) {
    const state = a.active ? 'en cours' : a.key ? `terminée à ${clock(a.clearedAt)}` : 'événement';
    const btn = a.ackedAt ? '' : `<button class="small" data-ack="${a.id}">Acquitter</button>`;
    html += `<li class="${a.severity} ${a.ackedAt ? 'acked' : 'unacked'}">${btn}
      <b>${esc(a.node)}</b> — ${esc(a.text)}<br>
      <span class="meta">${a.severity} · levée à ${clock(a.raisedAt)} · ${state}${a.ackedAt ? ' · acquittée' : ''}</span></li>`;
  }
  $('alerts').innerHTML = html || '<li>Aucune alerte</li>';
}

function renderCommands() {
  const labels = { pending: 'en attente', ok: 'OK', warn: 'attention', ko: 'refusée', timeout: 'sans réponse' };
  let html = '';
  for (const c of commands) {
    const lat = c.latencyMs !== undefined ? ` · ack en ${c.latencyMs} ms` : '';
    html += `<li class="${c.status}"><b>${esc(c.node)}</b> ${esc(c.action)} ${esc(c.value ?? '')} → <b>${labels[c.status]}</b>${lat}<br>
      <span class="meta">${esc(c.detail)} · ${new Date(c.sentAt).toLocaleTimeString('fr-FR')} · ${c.id}</span></li>`;
  }
  $('commands').innerHTML = html || '<li>Aucune commande</li>';
}

function commandButtons(n) {
  const b = (action, value, label) => `<button class="small" data-cmd="${action}" data-val="${value ?? ''}">${label}</button>`;
  let html = '';
  if (n.kind === 'enclosure') {
    html += `<div class="cmd-row"><span>Lampe chauffante</span>${b('lamp', 'on', 'on')}${b('lamp', 'off', 'off')}${b('lamp', 'auto', 'auto')}</div>`;
    html += `<div class="cmd-row"><span>Éclairage</span>${b('light', 'on', 'on')}${b('light', 'off', 'off')}${b('light', 'auto', 'auto')}</div>`;
    html += `<div class="cmd-row"><span>Consigne (°C)</span><input id="in-setpoint" type="number" min="20" max="50" value="${n.prof.hotDay}"><button class="small" data-cmd="setpoint" data-input="in-setpoint">envoyer</button></div>`;
    html += `<div class="cmd-row"><span>Coupure sécurité</span>${b('safety_cut', 'true', 'couper le chauffage')}${b('safety_cut', 'false', 'rétablir')}</div>`;
  }
  if (n.kind !== 'door') {
    html += `<div class="cmd-row"><span>Intervalle (s)</span><input id="in-interval" type="number" min="5" max="3600" value="${n.kind === 'outdoor' ? 300 : 30}"><button class="small" data-cmd="interval" data-input="in-interval">envoyer</button></div>`;
  }
  html += `<div class="cmd-row"><span>Maintenance</span>${b('identify', '', 'identifier (LED)')}${b('reboot', '', 'redémarrer')}</div>`;
  return html;
}

function openDetail(id) {
  const n = nodes.get(id);
  selected = id;
  $('detail').hidden = false;
  $('detail-title').textContent = `${n.id} — ${n.prof ? n.prof.label : n.label}`;
  $('detail-cmds').innerHTML = commandButtons(n);
  const sensors = n.kind === 'room' ? ['temp_ambient'] : n.kind === 'door' ? [] : ['temp_hot', 'temp_cold', 'light'];
  const colors = { temp_hot: '#d9480f', temp_cold: '#1971c2', light: '#b59f00', temp_ambient: '#5f3dc4' };
  const names = { temp_hot: 'Point chaud (°C)', temp_cold: 'Point froid (°C)', light: 'Lumière (lx)', temp_ambient: 'Ambiance (°C)' };
  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'line',
    data: {
      datasets: sensors.map((s) => ({
        label: names[s], data: [], borderColor: colors[s], backgroundColor: colors[s],
        yAxisID: s === 'light' ? 'y1' : 'y', pointRadius: 0, borderWidth: 2, tension: 0.2, sensor: s,
      })),
    },
    options: {
      animation: false,
      parsing: false,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { type: 'linear', ticks: { callback: (v) => clock(v).slice(0, 5), maxTicksLimit: 7 } },
        y: { title: { display: true, text: '°C' } },
        y1: { position: 'right', display: sensors.includes('light'), title: { display: true, text: 'lx' }, grid: { drawOnChartArea: false } },
      },
      plugins: { tooltip: { callbacks: { title: (items) => clock(items[0].parsed.x) } } },
    },
  });
  dirty = true;
}

function renderDetail() {
  if (!selected) return;
  const n = nodes.get(selected);
  const p = n.prof;
  let html = '<div class="values">';
  for (const [sensor, r] of Object.entries(n.readings)) {
    const age = Math.round((simNow - r.t) / 1000);
    html += `<div class="value">${sensor}<br><b>${fmtVal(sensor, r.value)}</b><br><small>il y a ${age} s</small></div>`;
  }
  const door = n.door === 'open' ? `<b class="door-open">OUVERTE</b> depuis ${Math.round((simNow - n.doorSince) / MIN)} min` : n.door === 'closed' ? '<b>fermée</b>' : '?';
  html += `<div class="value">porte<br>${door}</div>`;
  const [cls, label] = nodeState(n);
  html += `<div class="value">node<br><b class="st-${cls}">${label}</b><br><small>RSSI ${n.status.rssi ?? '--'} dBm</small></div></div>`;
  if (p && p.hotDay != null) {
    html += `<p><small>Profil : point chaud ${p.hotDay} °C le jour · point froid ${p.coldDay[0]}–${p.coldDay[1]} °C · nuit ${p.night[0]}–${p.night[1]} °C · photopériode ${p.photo[0]} h–${p.photo[1]} h · ${p.luxDay} lx</small></p>`;
  }
  $('detail-values').innerHTML = html;

  if (chart) {
    for (const ds of chart.data.datasets) ds.data = (n.history[ds.sensor] || []).slice();
    chart.options.scales.x.min = simNow - CONFIG.historyMinutes * MIN;
    chart.options.scales.x.max = simNow;
    chart.update('none');
  }
}

function render() {
  if (!dirty) return;
  dirty = false;
  $('simclock').textContent = simNow ? `Heure simulée : ${fmtDay.format(simNow)} ${clock(simNow)}` : 'Heure simulée : --';
  renderOverview();
  renderNodesTable();
  renderAlerts();
  renderCommands();
  renderDetail();
}

function setConn(cls, text) {
  const el = $('conn');
  el.className = `conn ${cls}`;
  el.textContent = text;
}

function getClientId() {
  // clientId fixe pour retrouver la session persistante
  const fresh = `front-${Math.random().toString(16).slice(2, 10)}`;
  try {
    let id = localStorage.getItem('mqttClientId');
    if (!id) {
      id = fresh;
      localStorage.setItem('mqttClientId', id);
    }
    return id;
  } catch {
    return fresh;
  }
}

function connect(url, username, password) {
  setConn('wait', 'Connexion…');
  $('login-error').textContent = '';
  client = mqtt.connect(url, {
    clientId: getClientId(),
    username,
    password,
    clean: false,
    keepalive: 30,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  });

  client.on('connect', () => {
    setConn('ok', `Connecté (${username})`);
    client.subscribe(`${ROOT}/#`, { qos: 1 });
    $('login').hidden = true;
    $('app').hidden = false;
  });
  client.on('reconnect', () => setConn('wait', 'Reconnexion…'));
  client.on('offline', () => setConn('off', 'Déconnecté, reprise automatique…'));
  client.on('error', (err) => {
    // mauvais identifiants : on arrete de reessayer
    if (/auth|identifier|password/i.test(err.message) || err.code === 4 || err.code === 5 || err.code === 135) {
      client.end(true);
      setConn('off', 'Refusé');
      $('login').hidden = false;
      $('app').hidden = true;
      $('login-error').textContent = 'Connexion refusée : identifiants invalides.';
    }
  });
  client.on('message', (topic, payload, packet) => onMessage(topic, payload, packet.retain));
}

$('login-url').value = CONFIG.brokerUrl;
$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  connect($('login-url').value, $('login-user').value, $('login-pass').value);
});
$('overview').addEventListener('click', (e) => {
  const card = e.target.closest('[data-node]');
  if (card) openDetail(card.dataset.node);
});
$('detail-close').addEventListener('click', () => {
  selected = null;
  $('detail').hidden = true;
  dirty = true;
});
$('detail-cmds').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cmd]');
  if (!btn || !selected) return;
  let value = btn.dataset.input ? Number($(btn.dataset.input).value) : btn.dataset.val;
  if (value === 'true' || value === 'false') value = value === 'true';
  if (value === '') value = undefined;
  sendCommand(selected, btn.dataset.cmd, value);
});
$('alerts').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ack]');
  if (btn) ackAlert(Number(btn.dataset.ack));
});

setInterval(() => { tick(); render(); }, 500);
