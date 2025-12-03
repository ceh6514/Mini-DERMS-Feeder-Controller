export type SimulationMode = 'day' | 'night';

interface SimulationState {
  override: SimulationMode | null;
  lastUpdated: Date | null;
}

const state: SimulationState = {
  override: null,
  lastUpdated: null,
};

const DAY_START_HOUR = 7;
const NIGHT_START_HOUR = 23;

function deriveMode(now: Date): SimulationMode {
  const hour = now.getHours() + now.getMinutes() / 60;
  return hour >= DAY_START_HOUR && hour < NIGHT_START_HOUR ? 'day' : 'night';
}

export function setSimulationMode(mode: SimulationMode) {
  state.override = mode;
  state.lastUpdated = new Date();
  return getSimulationMode(new Date());
}

export function clearSimulationOverride() {
  state.override = null;
  state.lastUpdated = new Date();
  return getSimulationMode(new Date());
}

export function getSimulationMode(now = new Date()) {
  const active = state.override ?? deriveMode(now);
  return {
    mode: active,
    source: state.override ? 'manual' : 'auto',
    lastUpdated: state.lastUpdated ? state.lastUpdated.toISOString() : null,
  };
}
