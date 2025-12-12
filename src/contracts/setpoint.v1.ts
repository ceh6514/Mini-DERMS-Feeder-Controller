import { DeviceType, MessageEnvelope } from './envelope';
import { JsonSchema } from './schemaValidator';

export type SetpointMode = 'charge' | 'discharge' | 'idle' | 'import' | 'export' | 'limit';

export interface SetpointCommandV1 {
  targetPowerKw: number;
  mode: SetpointMode;
  validUntilMs: number;
}

export interface SetpointConstraintsV1 {
  rampRateKwPerS?: number;
}

export interface SetpointReasonV1 {
  allocator: string;
  notes?: string;
}

export interface SetpointPayloadV1 {
  command: SetpointCommandV1;
  constraints?: SetpointConstraintsV1;
  reason: SetpointReasonV1;
}

export interface SetpointMessageV1 extends MessageEnvelope {
  messageType: 'setpoint';
  deviceType: DeviceType;
  payload: SetpointPayloadV1;
}

export const setpointPayloadSchemaV1: JsonSchema = {
  type: 'object',
  required: ['command', 'reason'],
  additionalProperties: false,
  properties: {
    command: {
      type: 'object',
      required: ['targetPowerKw', 'mode', 'validUntilMs'],
      additionalProperties: false,
      properties: {
        targetPowerKw: { type: 'number' },
        mode: {
          type: 'string',
          enum: ['charge', 'discharge', 'idle', 'import', 'export', 'limit'],
        },
        validUntilMs: { type: 'integer', minimum: 0 },
      },
    },
    constraints: {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: {
        rampRateKwPerS: { type: 'number', minimum: 0 },
      },
    },
    reason: {
      type: 'object',
      required: ['allocator'],
      additionalProperties: false,
      properties: {
        allocator: { type: 'string', minLength: 1 },
        notes: { type: 'string', minLength: 1 },
      },
    },
  },
};

export const setpointMessageSchemaV1: JsonSchema = {
  type: 'object',
  required: ['v', 'messageType', 'messageId', 'deviceId', 'deviceType', 'timestampMs', 'payload'],
  additionalProperties: false,
  properties: {
    v: { type: 'integer', minimum: 1 },
    messageType: { type: 'string', enum: ['setpoint'] },
    messageId: { type: 'string', format: 'uuid' },
    deviceId: { type: 'string', minLength: 1 },
    deviceType: { type: 'string', enum: ['pv', 'battery', 'ev'] },
    timestampMs: { type: 'integer', minimum: 0 },
    sentAtMs: { type: 'integer', minimum: 0 },
    correlationId: { type: 'string', minLength: 1 },
    source: { type: 'string', enum: ['simulator', 'pi-agent', 'backend', 'unknown'] },
    payload: setpointPayloadSchemaV1,
  },
};
