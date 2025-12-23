import {
  ContractValidationError,
  TelemetryMessageV1,
  contractVersion,
  validateTelemetryMessage,
} from '../contracts';
import { incrementCounter, setGaugeValue } from '../observability/metrics';
import config from '../config';

export type TelemetryPersistResult = 'inserted' | 'duplicate';

export interface TelemetryPersistence {
  save: (row: TelemetrySaveRow) => Promise<TelemetryPersistResult>;
  saveBatch?: (rows: TelemetrySaveRow[]) => Promise<TelemetryPersistResult[]>;
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
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
}

interface LatestMarker {
  tsMs: number;
  sentAtMs?: number;
}

interface TelemetryTask {
  row: TelemetrySaveRow;
  message: TelemetryMessageV1;
  newest: boolean;
  resolve: (result: { status: TelemetryPersistResult; newest: boolean; parsed?: TelemetryMessageV1 }) => void;
  reject: (err: unknown) => void;
}

export class TelemetryHandler {
  private latestByDevice = new Map<string, LatestMarker>();
  private queue: TelemetryTask[] = [];
  private flushing = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private persistence: TelemetryPersistence, private options: TelemetryHandlerOptions = {}) {
    setGaugeValue('derms_telemetry_ingest_queue_depth', 0);
  }

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

      return await this.enqueue(row, message, newest);
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

  private getBatchSize() {
    return Math.max(1, this.options.batchSize ?? 1);
  }

  private getFlushIntervalMs() {
    return Math.max(0, this.options.flushIntervalMs ?? 50);
  }

  private getMaxQueueSize() {
    return Math.max(1, this.options.maxQueueSize ?? 500);
  }

  private enqueue(
    row: TelemetrySaveRow,
    message: TelemetryMessageV1,
    newest: boolean,
  ): Promise<{ status: TelemetryPersistResult; newest: boolean; parsed?: TelemetryMessageV1 }> {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= this.getMaxQueueSize()) {
        incrementCounter('derms_telemetry_dropped_total', { reason: 'backpressure' });
        reject(new Error('telemetry_backpressure_queue_full'));
        return;
      }

      this.queue.push({ row, message, newest, resolve, reject });
      setGaugeValue('derms_telemetry_ingest_queue_depth', this.queue.length);
      this.scheduleFlush();
    });
  }

  private scheduleFlush() {
    if (this.queue.length >= this.getBatchSize()) {
      void this.flush();
      return;
    }
    if (!this.flushTimer) {
      const delay = this.getFlushIntervalMs();
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, delay);
    }
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.getBatchSize());
        await this.persistBatch(batch);
        setGaugeValue('derms_telemetry_ingest_queue_depth', this.queue.length);
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  private async persistBatch(batch: TelemetryTask[]) {
    try {
      const rows = batch.map((item) => item.row);
      let statuses: TelemetryPersistResult[] | null = null;
      if (this.persistence.saveBatch) {
        statuses = await this.persistence.saveBatch(rows);
      }
      if (!statuses || statuses.length !== rows.length) {
        statuses = [];
        for (const row of rows) {
          // eslint-disable-next-line no-await-in-loop
          statuses.push(await this.persistence.save(row));
        }
      }

      statuses.forEach((status, idx) => {
        const task = batch[idx];
        if (status === 'duplicate') {
          incrementCounter('derms_duplicate_message_total', { messageType: 'telemetry' });
        }

        if (task.newest) {
          this.markLatest(task.message.deviceId, task.message.timestampMs, task.message.sentAtMs);
        }

        task.resolve({ status, newest: task.newest, parsed: task.message });
      });
    } catch (err) {
      batch.forEach((task) => task.reject(err));
      throw err;
    }
  }
}
