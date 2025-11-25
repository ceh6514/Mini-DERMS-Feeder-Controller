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
  latestTelemetry: DeviceTelemetry | null;
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
