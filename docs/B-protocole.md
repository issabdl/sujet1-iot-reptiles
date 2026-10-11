# Partie B : protocole MQTT

## B.1 Arborescence des topics

Racine unique `reptiles/`, puis la zone, puis l'identifiant du node :

```
reptiles/{zone}/{nodeId}/reading/{sensor}   mesure d'un capteur
reptiles/{zone}/{nodeId}/door               état de la porte
reptiles/{zone}/{nodeId}/status             état du node (heartbeat, naissance, Last Will)
reptiles/{zone}/{nodeId}/event              événement ponctuel (boot)
reptiles/{zone}/{nodeId}/cmd                commande vers le node
reptiles/{zone}/{nodeId}/ack                acquittement d'une commande
```

- `zone` : `DES`, `TRO`, `QUA`, `SOI`, `EXT`, et `BAT` pour les 3 portes de bâtiment.
- `nodeId` : identifiant du node tel qu'il est flashé (`N-DES-01`, `N-ROOM-TRO`, `N-DOOR-FEED`…).
- `sensor` : `temp_hot`, `temp_cold`, `light`, `temp_ambient`.

Exemples : `reptiles/DES/N-DES-02/door`, `reptiles/TRO/N-TRO-05/reading/temp_hot`.

Pourquoi cet ordre :

- la zone en 2e niveau permet de s'abonner à une salle entière (`reptiles/QUA/#`) ;
- le node en 3e niveau permet une ACL par node (`reptiles/+/%u/#`, voir B.7) ;
- un sous-topic par capteur permet un message retenu par capteur : la dernière valeur de chaque capteur est disponible dès la connexion du front.

## B.2 Format des messages

JSON UTF-8. Champs communs à tous les messages émis par un node :

| champ | type | rôle |
|---|---|---|
| `v` | entier | version du format (`1`). Un consommateur ignore un message dont il ne connaît pas la version. |
| `node` | texte | identifiant du node émetteur |
| `seq` | entier | numéro de séquence croissant |
| `ts` | ms epoch | horodatage donné par le node (peut être faux, voir B.6) |
| `rxTs` | ms epoch | horodatage de réception par la passerelle (fait foi) |

Champs spécifiques :

| message | champs | exemple |
|---|---|---|
| reading | `sensor`, `value`, `unit` | `{"v":1,"node":"N-DES-01","seq":812,"ts":…,"rxTs":…,"sensor":"temp_hot","value":39.8,"unit":"C"}` |
| door | `state` (`open` / `closed`) | `{"v":1,"node":"N-DES-02","seq":901,"ts":…,"rxTs":…,"state":"open"}` |
| status | `online`, `uptimeS`, `rssi`, `fw`, `battery` (si pile) | `{"v":1,"node":"N-EXT-02","online":true,"uptimeS":86400,"rssi":-110,"fw":"1.4.2","battery":14,…}` |
| event | `event`, `reason` | `{"v":1,"node":"N-QUA-03","event":"boot","reason":"watchdog",…}` |
| cmd | `id`, `action`, `value`, `ts` | `{"v":1,"id":"c-lx3k9-a1","action":"lamp","value":"off","ts":…}` |
| ack | `cmdId`, `action`, `ok`, `detail` | `{"v":1,"node":"N-TRO-05","cmdId":"c-lx3k9-a1","action":"lamp","ok":true,"detail":"ok",…}` |

Le numéro de version est dans le message plutôt que dans le topic : on garde un seul arbre de topics et les ACL ne changent pas lors d'une évolution du format.

## B.3 QoS, retain et sessions

| message | QoS | retain | justification |
|---|---|---|---|
| reading | 0 | oui | mesure périodique (30 s) : une mesure perdue est remplacée par la suivante. Retenue pour que le front affiche la dernière valeur dès sa connexion. |
| door | 1 | oui | événement critique (intrusion, porte mal fermée) : il ne doit pas être perdu. Retenu = état courant de la porte. |
| status | 1 | oui | état du node, écrasé par le Last Will en cas de perte de connexion. |
| event | 1 | non | un boot doit être vu, mais n'a pas de sens comme état courant. |
| cmd | 1 | non | une commande doit arriver ; non retenue pour qu'une vieille commande ne soit pas rejouée à la connexion d'un node. |
| ack | 1 | non | réponse attendue par le front, corrélée par `cmdId`. |

QoS 2 n'est pas utilisé : il double les échanges, et le doublon possible du QoS 1 est soit sans effet (un état de porte reçu deux fois reste le même), soit filtré par l'identifiant de commande (B.5).

Sessions :

- **nodes** : `clean session = true`. Une commande envoyée pendant qu'un node est hors ligne ne doit pas être exécutée 10 minutes plus tard.
- **front** : `clean session = false` et abonnement en QoS 1. Si le navigateur perd la connexion, Mosquitto garde en file les messages QoS 1 (portes, status, acks, boots) et les livre à la reconnexion. Avec la persistance activée, cette file survit aussi à un redémarrage du broker.

**Coupure réseau de moins de 10 minutes** (aucune alerte critique perdue) :

1. côté passerelle : les messages sont mis en tampon en mémoire pendant la coupure et republiés dans l'ordre à la reconnexion (adaptateur, partie C) ;
2. côté broker : persistance sur disque (`persistence true`) ;
3. côté front : session persistante, les messages QoS 1 sont mis en file par le broker (`max_queued_messages 10000`, largement assez pour 10 minutes de portes et de status).

## B.4 Last Will et clientId

**Convention de clientId** :

| client | clientId | exemple |
|---|---|---|
| node | son identifiant, identique à son nom d'utilisateur | `N-DES-01` |
| front | `front-` + 8 caractères aléatoires, conservés dans le navigateur | `front-3f9a12bc` |
| outil d'administration | `admin-` + nom de l'outil | `admin-sub` |

Un clientId stable est nécessaire pour la session persistante du front (le broker retrouve la file d'attente de ce client) et rend les logs du broker lisibles.

**Last Will** : chaque node se connecte avec un testament sur son topic `status` :

```
topic   : reptiles/{zone}/{nodeId}/status
payload : {"v":1,"node":"N-DES-01","online":false,"reason":"connection_lost"}
QoS 1, retain true
```

À la connexion, le node publie aussitôt `{"online":true}` en retenu (message de naissance), puis ses heartbeats sur le même topic. Si la connexion TCP tombe sans déconnexion propre, le broker publie le testament : le front voit le node hors ligne sans attendre l'expiration d'un délai.

Le Last Will ne couvre pas un node bloqué mais toujours connecté, ni un node derrière une passerelle qui reste connectée. Le front détecte donc aussi l'absence de messages (heartbeat ou mesure) au-delà d'un délai (partie E).

## B.5 Commandes et acquittements

```
front                          broker                         node
  | cmd {id:"c-42", action:"lamp", value:"off"}  QoS 1          |
  |------------------------------->|--------------------------->|
  |                                |       exécute, puis ack    |
  |       ack {cmdId:"c-42", ok:true, detail:"ok"}  QoS 1       |
  |<-------------------------------|<---------------------------|
```

- **Corrélation** : le front génère un `id` unique (`c-` + horodatage en base 36 + aléatoire). Le node recopie cet `id` dans le champ `cmdId` de son ack. Le front est abonné à `reptiles/+/+/ack` et retrouve la commande en attente grâce à cet `id`.
- **Doublons** : en QoS 1 une commande peut arriver deux fois. Le node garde les 50 derniers `id` reçus ; s'il revoit un `id`, il ne réexécute pas (important pour `reboot`).
- **Délai d'expiration** : 5 s (temps réel). Un ack arrive normalement en moins de 200 ms ; 5 s laissent de la marge sur un réseau chargé sans laisser l'opérateur dans le doute.
- **Si le node ne répond pas** : la commande passe en état « sans réponse » dans le front (affichée en rouge). Le front ne renvoie pas la commande automatiquement : certaines commandes ne sont pas idempotentes (`reboot`) et l'opérateur doit d'abord vérifier l'état du node (hors ligne, muet). Comme la session du node est `clean`, la commande ne sera pas exécutée plus tard par surprise.
- **Ack négatif** : `ok:false` avec `detail` (`bad_value`, `not_supported`, `unknown_action`), affiché tel quel. Cas particulier : `applied_but_relay_feedback_on` (relais collé) est affiché comme un avertissement : la commande est acceptée mais sans effet, il faut utiliser `safety_cut`.

## B.6 Horodatage : qui fait foi ?

Deux horodatages dans chaque message :

- `ts` : horloge du node ;
- `rxTs` : horloge de la passerelle, au moment où elle reçoit le message du node.

**C'est `rxTs` qui fait foi** pour l'affichage, les courbes et le calcul des alertes. Raisons, toutes observées dans le simulateur :

1. après un redémarrage, un node n'a pas encore de synchro NTP (2 minutes environ) : son `ts` part de 0 (date de 1970) ;
2. l'horloge d'un node peut dériver (N-TRO-06 dérive de 4 s par minute dans le scénario `incidents`) ;
3. la passerelle est une machine sur secteur, synchronisée NTP en permanence : une seule horloge de référence pour tout le site.

`rxTs` est posé à la réception, **avant** la mise en tampon : si le broker est injoignable, les messages republiés plus tard gardent leur heure réelle et les courbes ne sont pas faussées.

`ts` n'est pas jeté : le front compare `ts` et `rxTs` et signale un node dont l'horloge s'écarte de plus de 60 s (horloge non synchronisée ou dérive). L'ordre des messages d'un même node est donné par `seq`.

## B.7 Sécurité du broker

- `allow_anonymous false` : tout client doit s'authentifier par nom d'utilisateur et mot de passe.
- Mots de passe stockés hachés (PBKDF2-SHA512) dans le fichier `passwd` généré par `mosquitto_passwd`.
- Un compte par node (nom = identifiant du node), un compte `front`, un compte `admin`.
- Les identifiants du front ne sont pas dans le code : l'opérateur les saisit dans l'écran de connexion.

ACL par rôle :

| rôle | lecture | écriture |
|---|---|---|
| node (`N-…`) | `reptiles/+/{son id}/cmd` | `reptiles/+/{son id}/#` |
| front | `reptiles/#` | `reptiles/+/+/cmd` |
| admin | `#`, `$SYS/#` | `#` |

Les droits des nodes sont écrits une seule fois grâce à la substitution `%u` (nom d'utilisateur) :

```
pattern read  reptiles/+/%u/cmd
pattern write reptiles/+/%u/#
```

Un node ne peut publier que sous son propre identifiant : un node compromis ne peut ni se faire passer pour un autre, ni envoyer de commandes. Le front ne peut pas publier de fausses mesures.

Limites assumées pour la démo (à corriger en production) :

- pas de TLS : en production, MQTT sur TLS (port 8883) pour les nodes et `wss://` pour le front ;
- un même mot de passe pour tous les comptes node ; en production chaque node reçoit un mot de passe (ou un certificat client) unique au moment du flashage.
