export interface DeviceTelemetry {
  id: number;
  device_id: string;
  ts: string;
  type: string;
  p_actual_kw: number;
  p_setpoint_kw: number | null;
  soc: number | null;
  site_id: string;
  device_p_max_kw: number;
}

export interface DeviceWithLatest {
  id: string;
  type: string;
  siteId: string;
  pMaxKw: number;
  priority?: number | null;
  latestTelemetry: DeviceTelemetry | null;
  isPi: boolean;
  isSimulated: boolean;
}

export interface FeederSummary {
  totalKw: number;
  limitKw: number;
  deviceCount: number;
  byType: Record<
    string,
    {
      count: number;
      totalKw: number;
    }
  >;
}

export interface DrEvent {
  id: string;
  ts_start: string;
  ts_end: string;
  limit_kw: number;
  type: string;
}

export type DrProgramMode = 'fixed_cap' | 'price_elastic';

export interface DrProgram {
  id: number;
  name: string;
  mode: DrProgramMode;
  ts_start: string;
  ts_end: string;
  target_shed_kw: number | null;
  incentive_per_kwh: number | null;
  penalty_per_kwh: number | null;
  is_active: boolean;
}

export interface DrImpactDevice {
  deviceId: string;
  allowedKw: number;
  pMax: number;
  utilizationPct: number;
  priority: number;
}

export interface DrImpactSnapshot {
  timestampIso: string;
  availableBeforeKw: number;
  availableAfterKw: number;
  shedAppliedKw: number;
  elasticityFactor: number;
  totalEvKw: number;
  nonEvKw: number;
  avgUtilizationPct: number;
  priorityWeightedUtilizationPct: number;
  activeProgram: DrProgram | null;
  perDevice: DrImpactDevice[];
}

export interface FeederHistoryPoint {
  ts: string; // ISO string
  totalKw: number;
}

export interface FeederHistoryResponse {
  limitKw: number;
  points: FeederHistoryPoint[];
}

export type MetricsWindow = 'day' | 'week' | 'month';

export interface HeadroomPoint {
  ts: string;
  totalKw: number;
  limitKw: number;
  utilizationPct: number;
  curtailmentPct: number;
  fairnessScore: number;
}

export interface DeviceAggregate {
  deviceId: string;
  deviceType: string;
  avgKw: number;
  maxKw: number;
  percentCurtailment: number;
  minSoc: number | null;
}

export interface SocTrajectoryPoint {
  ts: string;
  deviceId: string;
  soc: number;
}

export interface AggregatedMetricsResponse {
  window: MetricsWindow;
  rangeStart: string;
  rangeEnd: string;
  feeder: {
    avgKw: number;
    maxKw: number;
    percentCurtailment: number;
    slaViolations: number;
    fairnessScore: number;
  };
  headroom: HeadroomPoint[];
  devices: DeviceAggregate[];
  socTrajectories: SocTrajectoryPoint[];
}

export type SimulationMode = 'day' | 'night';

export interface SimulationModeResponse {
  mode: SimulationMode;
  source: 'auto' | 'manual';
  lastUpdated: string | null;
}

export interface OfflineDeviceSummary {
  deviceId: string;
  lastHeartbeat: string | null;
}

export interface ControlLoopStatus {
  status: 'idle' | 'ok' | 'error' | 'stalled';
  lastIterationIso: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  offlineDevices: OfflineDeviceSummary[];
  offlineCount: number;
  heartbeatTimeoutSeconds: number;
  stallThresholdSeconds: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  db: { ok: boolean };
  mqtt: {
    host: string;
    port: number;
    connected: boolean;
    lastError: string | null;
  };
  controlLoop: ControlLoopStatus;
}
