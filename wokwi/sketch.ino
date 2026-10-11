// Node enclos interieur : 2 DS18B20, lumiere, porte sur interruption

#include <OneWire.h>
#include <DallasTemperature.h>

const char *NODE_ID = "N-DES-01";
const int PIN_TEMP_HOT = 4;
const int PIN_TEMP_COLD = 5;
const int PIN_LIGHT = 34;     // photoresistance a la place du VEML7700
const int PIN_DOOR = 27;

const unsigned long PERIOD_MS = 5000;  // 30 s en vrai
const unsigned long DEBOUNCE_MS = 50;

OneWire busHot(PIN_TEMP_HOT);
OneWire busCold(PIN_TEMP_COLD);
DallasTemperature probeHot(&busHot);
DallasTemperature probeCold(&busCold);

volatile bool doorEvent = false;
volatile unsigned long doorEventMs = 0;
bool doorOpen = false;
unsigned long lastReading = 0;
unsigned long seq = 0;

void IRAM_ATTR onDoorChange() {
  doorEvent = true;
  doorEventMs = millis();
}

void sendJson(const String &body) {
  seq++;
  Serial.printf("{\"node\":\"%s\",\"ts\":%lu,\"seq\":%lu,%s}\n", NODE_ID, millis(), seq, body.c_str());
}

void sendReading(const char *sensor, float value, const char *unit) {
  sendJson(String("\"type\":\"reading\",\"sensor\":\"") + sensor + "\",\"value\":" + String(value, 2) + ",\"unit\":\"" + unit + "\"");
}

// formule de la doc Wokwi
float readLux() {
  const float GAMMA = 0.7;
  const float RL10 = 50;
  int raw = analogRead(PIN_LIGHT);
  float voltage = raw / 4095.0 * 3.3;
  if (voltage >= 3.29) return 0;
  float resistance = 2000 * voltage / (1 - voltage / 3.3);
  return pow(RL10 * 1e3 * pow(10, GAMMA) / resistance, 1 / GAMMA);
}

void readSensors() {
  probeHot.requestTemperatures();
  probeCold.requestTemperatures();
  sendReading("temp_hot", probeHot.getTempCByIndex(0), "C");
  sendReading("temp_cold", probeCold.getTempCByIndex(0), "C");
  sendReading("light", readLux(), "lx");
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_DOOR, INPUT_PULLUP);
  probeHot.begin();
  probeCold.begin();
  probeHot.setResolution(12);
  probeCold.setResolution(12);

  doorOpen = digitalRead(PIN_DOOR) == HIGH;
  attachInterrupt(digitalPinToInterrupt(PIN_DOOR), onDoorChange, CHANGE);

  sendJson("\"type\":\"boot\",\"reason\":\"power_on\"");
  sendJson(String("\"type\":\"door\",\"state\":\"") + (doorOpen ? "open" : "closed") + "\"");
}

void loop() {
  // anti-rebond
  if (doorEvent && millis() - doorEventMs >= DEBOUNCE_MS) {
    doorEvent = false;
    bool open = digitalRead(PIN_DOOR) == HIGH;
    if (open != doorOpen) {
      doorOpen = open;
      sendJson(String("\"type\":\"door\",\"state\":\"") + (open ? "open" : "closed") + "\"");
    }
  }

  if (millis() - lastReading >= PERIOD_MS) {
    lastReading = millis();
    readSensors();
  }
  delay(5);
}
