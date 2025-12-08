export interface ControlParams {
  globalKwLimit: number;
  minSocReserve: number;
  targetSoc: number;
  respectPriority: boolean;
  socWeight: number;
  allocationMode?: 'heuristic' | 'optimizer';
  optimizer?: {
    enforceTargetSoc?: boolean;
    solverEnabled?: boolean;
  };
}

export interface DeviceState {
  id: string;
  type: string;
  siteId: string;
  feederId: string;
  pMaxKw: number;
  priority: number;
  soc: number | null;
  isPhysical: boolean;
  isSimulated: boolean;
  pActualKw: number;
  currentSetpointKw: number;
}

export interface DeviceMetrics {
  deviceId: string;
  type: string;
  siteId: string;
  feederId: string;
  avgAbsError: number;
  lastSetpointKw: number | null;
  lastActualKw: number | null;
  priority: number;
  soc: number | null;
  isPhysical: boolean;
}
