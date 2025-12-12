import { JsonSchema } from './schemaValidator';

export const contractVersion = 1;

export type MessageSource = 'simulator' | 'pi-agent' | 'backend' | 'unknown';
export type DeviceType = 'pv' | 'battery' | 'ev';
export type MessageType = 'telemetry' | 'setpoint' | 'ack';

export interface MessageEnvelope {
  v: number;
  messageType: MessageType;
  messageId: string;
  deviceId: string;
  deviceType: DeviceType;
  timestampMs: number;
  sentAtMs?: number;
  correlationId?: string;
  source?: MessageSource;
}

export const envelopeSchema: JsonSchema = {
  type: 'object',
  required: ['v', 'messageType', 'messageId', 'deviceId', 'deviceType', 'timestampMs'],
  additionalProperties: false,
  properties: {
    v: { type: 'integer', minimum: 1 },
    messageType: { type: 'string', enum: ['telemetry', 'setpoint', 'ack'] },
    messageId: { type: 'string', format: 'uuid' },
    deviceId: { type: 'string', minLength: 1 },
    deviceType: { type: 'string', enum: ['pv', 'battery', 'ev'] },
    timestampMs: { type: 'integer', minimum: 0 },
    sentAtMs: { type: 'integer', minimum: 0 },
    correlationId: { type: 'string', minLength: 1 },
    source: { type: 'string', enum: ['simulator', 'pi-agent', 'backend', 'unknown'] },
  },
};

export function isSupportedVersion(version: number): boolean {
  return version === contractVersion;
}

