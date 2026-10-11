# Simulateur du centre de réhabilitation pour reptiles

Simule les capteurs de 21 enclos, 4 salles et 3 portes de bâtiment. Aucune dépendance (Node 20+).

```bash
npm start                                   # scénario "incidents", 1 s réelle = 1 min simulée
node src/index.js --format json             # une ligne JSON par message
node src/index.js --scenario chaos --speed 120
```

## Messages émis

Tous les messages ont `node`, `ts` (horodatage **fourni par le device**, en ms), `seq`, `type`.

| type | champs | fréquence |
|---|---|---|
| `reading` | `sensor` (`temp_hot`, `temp_cold`, `light`, `temp_ambient`), `value`, `unit` | 30 s (secteur), 300 s (batterie) |
| `door` | `state` (`open` / `closed`) | sur changement d'état |
| `heartbeat` | `uptimeS`, `rssi`, `fw`, `battery` (si batterie) | 5 min (secteur), 30 min (batterie) |
| `boot` | `reason` | au démarrage d'un node |
| `ack` | `cmdId`, `action`, `ok`, `detail` | en réponse à une commande |

## Commandes

Pour l'instant, une commande JSON par ligne sur stdin :

```json
{"id":"c1","target":"N-DES-01","action":"lamp","value":"off"}
```

| action | value | cible |
|---|---|---|
| `lamp`, `light` | `on` / `off` / `auto` | node d'enclos intérieur |
| `setpoint` | 20 à 50 (°C, point chaud) | node d'enclos intérieur |
| `safety_cut` | `true` / `false` (coupe tout le chauffage) | node d'enclos intérieur |
| `interval` | 5 à 3600 (s) | node avec mesures périodiques |
| `reboot`, `identify` | | tous |

Taper `snapshot` sur stdin affiche l'état réel de la simulation (débogage uniquement).

## Architecture

```
src/
  index.js            CLI, choix de l'adaptateur de sortie
  simulator.js        modèle (thermique, lumière, portes, nodes)
  scenarios.js        incidents
  facility.js         description du site
  species.js          profils d'élevage
  outputs/console.js  adaptateur stdout/stdin (modèle pour vos adaptateurs)
```

Un adaptateur expose `start(sim)` et `stop()`, écoute `sim.on('message')` et transmet les commandes reçues à `sim.handleCommand(cmd)`.

## Sortie MQTT (ajoutée)

```bash
npm install
SIM_OUTPUT=console,mqtt MQTT_URL=mqtt://localhost:1883 node src/index.js
```

`src/outputs/mqtt.js` ouvre une connexion MQTT par node (clientId et login = identifiant du node) :

- publication sur `reptiles/<zone>/<node>/{reading/<capteur>,door,status,event,ack}` (QoS et retain : voir `docs/B-protocole.md`) ;
- abonnement à `reptiles/<zone>/<node>/cmd`, exécution via `sim.handleCommand()`, l'ack part sur `.../ack` ;
- Last Will retenu `{"online":false}` sur `.../status`, message de naissance `{"online":true}` à la connexion ;
- reconnexion automatique toutes les 2 s, messages gardés en tampon mémoire pendant la coupure puis republiés dans l'ordre ;
- ajout de `v` (version du format) et de `rxTs` (horodatage passerelle) dans chaque message.

Variables d'environnement : `SIM_OUTPUT`, `SIM_SPEED`, `SIM_SCENARIO`, `SIM_SEED`, `SIM_START`, `SIM_FORMAT`, `MQTT_URL`, `MQTT_NODE_PASSWORD`, `MQTT_TOPIC_ROOT`, `MQTT_BUFFER_MAX` (détail : `node src/index.js --help`).

`simulator.js` et `scenarios.js` ne sont pas modifiés.
