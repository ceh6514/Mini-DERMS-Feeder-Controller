import { randomUUID } from 'crypto';
import config from '../config';
import logger from '../logger';

export type DeviceDecisionRecord = {
  deviceId?: string;
  deviceType: string;
  telemetryAgeMs: number;
  soc: number | null;
  priority: number;
  caps: {
    maxChargeKw?: number | null;
    maxDischargeKw?: number | null;
  };
  requestedKw: number;
  eligibleKw: number;
  allocatedKw: number;
  reasonCodes: string[];
  setpoint: {
    targetPowerKw: number;
    validUntilMs: number;
  };
};

export type PublishFailure = {
  deviceType: string;
  reason: string;
  deviceId?: string;
};

export type FeederDecisionRecord = {
  feederId: string;
  headroomKwAvailable: number;
  headroomKwAllocated: number;
  headroomKwUnused: number;
  limitingConstraint?: string;
  inputs: {
    deviceCountSeen: number;
    deviceCountFresh: number;
    deviceCountStale: number;
    staleThresholdMs: number;
  };
  devices: DeviceDecisionRecord[];
  publish: {
    attemptedCount: number;
    successCount: number;
    failCount: number;
    failures: PublishFailure[];
  };
};

export type DecisionRecord = {
  cycleId: string;
  startedAtMs: number;
  finishedAtMs: number;
  durationMs: number;
  feeders: FeederDecisionRecord[];
};

export class DecisionRecordBuilder {
  private readonly record: DecisionRecord;

  constructor(startedAtMs: number, cycleId?: string) {
    const resolvedId = cycleId ?? randomUUID();
    this.record = {
      cycleId: resolvedId,
      startedAtMs,
      finishedAtMs: startedAtMs,
      durationMs: 0,
      feeders: [],
    };
  }

  addFeeder(feeder: Omit<FeederDecisionRecord, 'publish' | 'devices'> & {
    publish?: FeederDecisionRecord['publish'];
    devices?: DeviceDecisionRecord[];
  }) {
    this.record.feeders.push({
      ...feeder,
      publish: feeder.publish ?? { attemptedCount: 0, successCount: 0, failCount: 0, failures: [] },
      devices: feeder.devices ?? [],
    });
  }

  finalize(finishedAtMs: number): DecisionRecord {
    this.record.finishedAtMs = finishedAtMs;
    this.record.durationMs = Math.max(0, finishedAtMs - this.record.startedAtMs);
    return this.record;
  }

  log(record: DecisionRecord = this.record) {
    const level = config.observability.decisionLogLevel === 'debug' ? 'debug' : 'info';
    if (level === 'debug') {
      logger.debug('[decision] control cycle', record as unknown as Record<string, unknown>);
    } else {
      logger.info('[decision] control cycle', record as unknown as Record<string, unknown>);
    }
  }
}
