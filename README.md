# Supervision temps réel d'un centre de réhabilitation pour reptiles

Projet UE02 IoT et systèmes embarqués.

```
Simulateur  <-- MQTT -->  Broker Mosquitto  <-- MQTT over WebSocket -->  Front web
```

## Installation et lancement

Prérequis : Docker avec Docker Compose.

```bash
docker compose up
```

Cette commande lance :

| Service | Rôle | Port |
|---|---|---|
| `broker` | Mosquitto : MQTT TCP pour les nodes, WebSocket pour le front, persistance, authentification, ACL | 1883, 9001 |
| `simulator` | simulateur du centre (scénario `incidents`, 1 s réelle = 1 min simulée) avec l'adaptateur MQTT, sortie console conservée | |
| `front` | front web (nginx, fichiers statiques) | 8090 |

Ouvrir ensuite **http://localhost:8090** et se connecter avec le compte `front`.

Comptes de démonstration (mots de passe hachés dans `mosquitto/passwd`) :

| Compte | Mot de passe | Rôle |
|---|---|---|
| `front` | `frontpass` | lecture de tout, envoi de commandes |
| `admin` | `adminpass` | tous les droits, `$SYS` |
| `N-DES-01`… (un par node) | `nodepass` | publication sous son propre identifiant uniquement |

Pour repartir d'un broker vide (messages retenus effacés) : `docker compose down -v` puis `docker compose up`.

### Variables d'environnement du simulateur

Définies dans `docker-compose.yml` :

| Variable | Défaut | Rôle |
|---|---|---|
| `SIM_OUTPUT` | `console` | sorties : `console`, `mqtt` ou `console,mqtt` |
| `SIM_SCENARIO` | `incidents` | `normal`, `incidents`, `chaos` |
| `SIM_SPEED` | `60` | accélération du temps |
| `SIM_SEED`, `SIM_START`, `SIM_FORMAT` | | graine, heure de départ, format console |
| `MQTT_URL` | `mqtt://localhost:1883` | adresse du broker |
| `MQTT_NODE_PASSWORD` | `nodepass` | mot de passe des comptes node |
| `MQTT_TOPIC_ROOT` | `reptiles` | racine des topics |
| `MQTT_BUFFER_MAX` | `5000` | messages gardés par node pendant une coupure |

## Organisation du dépôt

```
docker-compose.yml       lance broker + simulateur + front
mosquitto/               configuration du broker (mosquitto.conf, acl, passwd, gen-passwd.sh)
support/                 simulateur fourni + adaptateur MQTT (src/outputs/mqtt.js)
front/                   front web (index.html, app.js, config.js, style.css, vendor/)
wokwi/                   node enclos intérieur (diagram.json, sketch.ino) : https://wokwi.com/projects/477594866988217345
docs/                    dossier technique (parties A, B, F), captures, schéma d'architecture
```

## Documentation

- `docs/A-materiel.md` : choix des composants, BOM, Wokwi, autonomie, architecture
- `docs/B-protocole.md` : topics, format des messages, QoS, Last Will, commandes, horodatage, sécurité
- `docs/F-validation.md` : validation sur le scénario `incidents`
- `docs/dossier.pdf` : dossier technique complet
