import {
  ContractValidationError,
  TelemetryMessageV1,
  contractVersion,
  validateTelemetryMessage,
} from '../contracts';
import { incrementCounter } from '../observability/metrics';
import config from '../config';

export type TelemetryPersistResult = 'inserted' | 'duplicate';

export interface TelemetryPersistence {
  save: (row: TelemetrySaveRow) => Promise<TelemetryPersistResult>;
}

export interface TelemetrySaveRow {
  message_id: string;
  message_version: number;
  message_type: 'telemetry';
  device_id: string;
  ts: Date;
  sent_at?: Date | null;
  type: string;
  p_actual_kw: number;
  p_setpoint_kw?: number | null;
  soc?: number | null;
  site_id: string;
  feeder_id: string;
  source?: string | null;
}

export interface TelemetryHandlerOptions {
  lenient?: boolean;
  allowFutureMs?: number;
}

interface LatestMarker {
  tsMs: number;
  sentAtMs?: number;
}

export class TelemetryHandler {
  private latestByDevice = new Map<string, LatestMarker>();

  constructor(private persistence: TelemetryPersistence, private options: TelemetryHandlerOptions = {}) {}

  isNewer(deviceId: string, tsMs: number, sentAtMs?: number): boolean {
    const current = this.latestByDevice.get(deviceId);
    if (!current) return true;
    if (tsMs > current.tsMs) return true;
    if (tsMs < current.tsMs) return false;
    if (sentAtMs !== undefined && current.sentAtMs !== undefined) {
      return sentAtMs > current.sentAtMs;
    }
    return false;
  }

  markLatest(deviceId: string, tsMs: number, sentAtMs?: number) {
    this.latestByDevice.set(deviceId, { tsMs, sentAtMs });
  }

  async handle(raw: unknown): Promise<{ status: TelemetryPersistResult; newest: boolean; parsed?: TelemetryMessageV1 }> {
    try {
      const message = validateTelemetryMessage(raw, this.options.lenient);
      const now = Date.now();
      if (message.timestampMs > now + (this.options.allowFutureMs ?? 30_000)) {
        throw new ContractValidationError('Telemetry timestamp is too far in the future');
      }

      const newest = this.isNewer(message.deviceId, message.timestampMs, message.sentAtMs);
      if (!newest) {
        incrementCounter('derms_out_of_order_total', { messageType: 'telemetry' });
      }

      const feederId = message.payload.feederId ?? message.payload.siteId ?? config.defaultFeederId;
      const siteId = message.payload.siteId ?? feederId;

      const row: TelemetrySaveRow = {
        message_id: message.messageId,
        message_version: contractVersion,
        message_type: 'telemetry',
        device_id: message.deviceId,
        ts: new Date(message.timestampMs),
        sent_at: message.sentAtMs ? new Date(message.sentAtMs) : null,
        type: message.deviceType,
        p_actual_kw: message.payload.readings.powerKw,
        p_setpoint_kw: null,
        soc: message.payload.readings.soc ?? null,
        site_id: siteId,
        feeder_id: feederId,
        source: message.source ?? 'unknown',
      };

      const status = await this.persistence.save(row);
      if (status === 'duplicate') {
        incrementCounter('derms_duplicate_message_total', { messageType: 'telemetry' });
      }

      if (newest) {
        this.markLatest(message.deviceId, message.timestampMs, message.sentAtMs);
      }

      return { status, newest, parsed: message };
    } catch (err) {
      const reason = err instanceof ContractValidationError ? err.details?.join(';') ?? err.message : 'unknown';
      if (err instanceof ContractValidationError && err.message.includes('Unsupported')) {
        incrementCounter('derms_contract_version_reject_total', {
          messageType: 'telemetry',
          reason,
        });
      }
      incrementCounter('derms_contract_validation_fail_total', {
        messageType: 'telemetry',
        reason,
      });
      throw err;
    }
  }
}
