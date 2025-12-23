type ReadinessReason = string | null;

let dbReady = false;
let dbReason: ReadinessReason = 'init';
let mqttReady = false;
let mqttReason: ReadinessReason = 'init';

export function setDbReady(ready: boolean, reason: ReadinessReason = null) {
  dbReady = ready;
  dbReason = ready ? null : reason;
}

export function setMqttReady(ready: boolean, reason: ReadinessReason = null) {
  mqttReady = ready;
  mqttReason = ready ? null : reason;
}

export function getReadiness() {
  return {
    dbReady,
    dbReason,
    mqttReady,
    mqttReason,
  };
}
