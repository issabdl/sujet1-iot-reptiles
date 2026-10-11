// Config du site (especes reprises de support/src/species.js) et des alertes

const CONFIG = {
  brokerUrl: `ws://${location.hostname || 'localhost'}:9001`,
  topicRoot: 'reptiles',
  timeZone: 'Europe/Paris',
  commandTimeoutMs: 5000, // temps reel
  historyMinutes: 30,

  zones: [
    { id: 'DES', label: 'Salle désertique' },
    { id: 'TRO', label: 'Salle tropicale' },
    { id: 'QUA', label: 'Quarantaine' },
    { id: 'SOI', label: 'Soins intensifs' },
    { id: 'EXT', label: 'Enclos extérieurs' },
    { id: 'BAT', label: 'Portes du bâtiment' },
  ],

  species: {
    pogona: { label: 'Agame barbu', hotDay: 40, coldDay: [24, 29], night: [18, 23], photo: [7, 20], luxDay: 32000 },
    uromastyx: { label: 'Fouette-queue', hotDay: 45, coldDay: [26, 31], night: [20, 24], photo: [7, 20], luxDay: 45000 },
    eublepharis: { label: 'Gecko léopard', hotDay: 32, coldDay: [23, 27], night: [19, 23], photo: [8, 20], luxDay: 3500 },
    python: { label: 'Python royal', hotDay: 32, coldDay: [25, 28], night: [23, 26], photo: [7, 19], luxDay: 2500 },
    boa: { label: 'Boa constricteur', hotDay: 33, coldDay: [25, 28], night: [22, 25], photo: [7, 19], luxDay: 3000 },
    chameleon: { label: 'Caméléon casqué', hotDay: 33, coldDay: [22, 27], night: [16, 21], photo: [7, 19], luxDay: 18000 },
    iguana: { label: 'Iguane vert', hotDay: 37, coldDay: [26, 30], night: [22, 26], photo: [7, 19], luxDay: 22000 },
    phelsuma: { label: 'Gecko diurne', hotDay: 34, coldDay: [24, 28], night: [19, 23], photo: [7, 19], luxDay: 15000 },
    quarantine: { label: 'Arrivant (profil prudent)', hotDay: 32, coldDay: [24, 28], night: [21, 25], photo: [8, 19], luxDay: 6000 },
    hospital: { label: 'Bac hospitalier', hotDay: 29, coldDay: [27, 29.5], night: [26, 29], photo: [8, 18], luxDay: 1200 },
    tortoise: { label: "Tortue d'Hermann", hotDay: null },
  },

  nodes: [
    { id: 'N-ROOM-DES', zone: 'DES', kind: 'room', label: 'Ambiance + porte salle' },
    { id: 'N-DES-01', zone: 'DES', kind: 'enclosure', label: 'DES-01', species: 'pogona' },
    { id: 'N-DES-02', zone: 'DES', kind: 'enclosure', label: 'DES-02', species: 'pogona' },
    { id: 'N-DES-03', zone: 'DES', kind: 'enclosure', label: 'DES-03', species: 'pogona' },
    { id: 'N-DES-04', zone: 'DES', kind: 'enclosure', label: 'DES-04', species: 'uromastyx' },
    { id: 'N-DES-05', zone: 'DES', kind: 'enclosure', label: 'DES-05', species: 'eublepharis' },
    { id: 'N-DES-06', zone: 'DES', kind: 'enclosure', label: 'DES-06', species: 'eublepharis' },
    { id: 'N-ROOM-TRO', zone: 'TRO', kind: 'room', label: 'Ambiance + porte salle' },
    { id: 'N-TRO-01', zone: 'TRO', kind: 'enclosure', label: 'TRO-01', species: 'python' },
    { id: 'N-TRO-02', zone: 'TRO', kind: 'enclosure', label: 'TRO-02', species: 'python' },
    { id: 'N-TRO-03', zone: 'TRO', kind: 'enclosure', label: 'TRO-03', species: 'boa' },
    { id: 'N-TRO-04', zone: 'TRO', kind: 'enclosure', label: 'TRO-04', species: 'chameleon' },
    { id: 'N-TRO-05', zone: 'TRO', kind: 'enclosure', label: 'TRO-05', species: 'iguana' },
    { id: 'N-TRO-06', zone: 'TRO', kind: 'enclosure', label: 'TRO-06', species: 'phelsuma' },
    { id: 'N-ROOM-QUA', zone: 'QUA', kind: 'room', label: 'Ambiance + porte salle' },
    { id: 'N-QUA-01', zone: 'QUA', kind: 'enclosure', label: 'QUA-01', species: 'quarantine' },
    { id: 'N-QUA-02', zone: 'QUA', kind: 'enclosure', label: 'QUA-02', species: 'quarantine' },
    { id: 'N-QUA-03', zone: 'QUA', kind: 'enclosure', label: 'QUA-03', species: 'quarantine' },
    { id: 'N-QUA-04', zone: 'QUA', kind: 'enclosure', label: 'QUA-04', species: 'quarantine' },
    { id: 'N-ROOM-SOI', zone: 'SOI', kind: 'room', label: 'Ambiance + porte salle' },
    { id: 'N-SOI-01', zone: 'SOI', kind: 'enclosure', label: 'SOI-01', species: 'hospital' },
    { id: 'N-SOI-02', zone: 'SOI', kind: 'enclosure', label: 'SOI-02', species: 'hospital' },
    { id: 'N-SOI-03', zone: 'SOI', kind: 'enclosure', label: 'SOI-03', species: 'hospital' },
    { id: 'N-EXT-01', zone: 'EXT', kind: 'outdoor', label: 'EXT-01', species: 'tortoise' },
    { id: 'N-EXT-02', zone: 'EXT', kind: 'outdoor', label: 'EXT-02', species: 'tortoise' },
    { id: 'N-DOOR-MAIN', zone: 'BAT', kind: 'door', label: 'Entrée principale' },
    { id: 'N-DOOR-SAS', zone: 'BAT', kind: 'door', label: 'Sas sanitaire' },
    { id: 'N-DOOR-FEED', zone: 'BAT', kind: 'door', label: 'Local nourriture' },
  ],

  // durees en minutes simulees
  alerts: {
    muteMin: { enclosure: 3, room: 4, outdoor: 16, door: 65 },
    doorOpenMaxMin: { enclosure: 10, outdoor: 15, room: 5, door: 5 },
    openHours: [7, 20],
    hotHighMargin: 3,
    hysteresis: 1,
    hotLowMargin: 6,
    coldMargin: 2,
    coldHighMargin: 3,
    warmupH: 1,
    lightMinRatio: 0.3,
    tempRange: [5, 55], // hors plage = valeur aberrante
    lightRange: [0, 100000],
    batteryLow: 20, // %
    batteryCritical: 10,
    clockSkewS: 60,
  },
};
