#!/usr/bin/env node
'use strict';

const { parseArgs } = require('node:util');
const { Simulator } = require('./simulator');
const { createConsoleOutput } = require('./outputs/console');
const { createMqttOutput } = require('./outputs/mqtt');

const env = process.env;
const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: env.SIM_SEED ?? '42' },
    speed: { type: 'string', default: env.SIM_SPEED ?? '60' },
    scenario: { type: 'string', default: env.SIM_SCENARIO ?? 'incidents' },
    output: { type: 'string', default: env.SIM_OUTPUT ?? 'console' },
    format: { type: 'string', default: env.SIM_FORMAT ?? 'pretty' },
    start: { type: 'string', default: env.SIM_START },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(`Usage : node src/index.js [options]
  --seed <n>          graine aleatoire (defaut 42)                         [SIM_SEED]
  --speed <n>         acceleration du temps (defaut 60 : 1 s = 1 min)      [SIM_SPEED]
  --scenario <nom>    normal | incidents | chaos (defaut incidents)        [SIM_SCENARIO]
  --output <noms>     console | mqtt | console,mqtt (defaut console)       [SIM_OUTPUT]
  --format <f>        pretty | json (sortie console)                       [SIM_FORMAT]
  --start <iso>       depart simule (defaut : aujourd'hui 07:45)           [SIM_START]

Sortie mqtt :
  MQTT_URL            url du broker (defaut mqtt://localhost:1883)
  MQTT_NODE_PASSWORD  mot de passe des comptes node (defaut nodepass)
  MQTT_TOPIC_ROOT     racine des topics (defaut reptiles)
  MQTT_BUFFER_MAX     taille max du tampon par node pendant une coupure (defaut 5000)`);
  process.exit(0);
}

const sim = new Simulator({
  seed: Number(values.seed),
  speed: Number(values.speed),
  scenario: values.scenario,
  start: values.start ? Date.parse(values.start) : undefined,
});

const outputs = {
  console: () => createConsoleOutput({ format: values.format }),
  mqtt: () => createMqttOutput({
    url: env.MQTT_URL,
    password: env.MQTT_NODE_PASSWORD,
    root: env.MQTT_TOPIC_ROOT,
    bufferMax: env.MQTT_BUFFER_MAX ? Number(env.MQTT_BUFFER_MAX) : undefined,
  }),
};

// ex : --output console,mqtt
const names = values.output.split(',').map((s) => s.trim()).filter(Boolean);
for (const name of names) {
  if (!outputs[name]) {
    console.error(`Sortie inconnue : ${name}`);
    process.exit(1);
  }
}

const outs = names.map((name) => outputs[name]());
for (const out of outs) out.start(sim);
sim.start(1000);

const shutdown = () => {
  sim.stop();
  // 2 s max pour fermer les sorties
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
  Promise.race([Promise.all(outs.map((out) => out.stop())), timeout]).finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
