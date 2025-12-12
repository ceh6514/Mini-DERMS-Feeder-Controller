import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DecisionRecordBuilder } from '../src/observability/decisionRecord';

describe('DecisionRecordBuilder', () => {
  it('builds a decision record with feeder and publish context', () => {
    const started = Date.now();
    const builder = new DecisionRecordBuilder(started, 'cycle-123');

    builder.addFeeder({
      feederId: 'feeder-1',
      headroomKwAvailable: 10,
      headroomKwAllocated: 7,
      headroomKwUnused: 3,
      limitingConstraint: 'HEADROOM_LIMIT',
      inputs: {
        deviceCountSeen: 5,
        deviceCountFresh: 4,
        deviceCountStale: 1,
        staleThresholdMs: 30_000,
      },
      devices: [
        {
          deviceId: 'ev-1',
          deviceType: 'ev',
          telemetryAgeMs: 1000,
          soc: 0.5,
          priority: 1,
          caps: { maxChargeKw: 7, maxDischargeKw: 7 },
          requestedKw: 3,
          eligibleKw: 7,
          allocatedKw: 5,
          reasonCodes: ['HEADROOM_LIMIT'],
          setpoint: {
            targetPowerKw: 5,
            validUntilMs: started + 10_000,
          },
        },
      ],
      publish: {
        attemptedCount: 1,
        successCount: 1,
        failCount: 0,
        failures: [],
      },
    });

    const record = builder.finalize(started + 50);

    assert.equal(record.cycleId, 'cycle-123');
    assert.equal(record.durationMs, 50);
    assert.equal(record.feeders.length, 1);
    assert.equal(record.feeders[0].headroomKwAllocated, 7);
    assert.equal(record.feeders[0].devices[0].allocatedKw, 5);
    assert.equal(record.feeders[0].publish.successCount, 1);
  });
});
