import { DeviceType, MessageEnvelope } from './envelope';
import { JsonSchema } from './schemaValidator';

export interface TelemetryReadingV1 {
  powerKw: number;
  energyKwh?: number;
  soc?: number;
  voltageV?: number;
  currentA?: number;
}

export interface TelemetryStatusV1 {
  online: boolean;
  faultCode?: string;
}

export interface TelemetryCapabilitiesV1 {
  maxChargeKw?: number;
  maxDischargeKw?: number;
  maxExportKw?: number;
  maxImportKw?: number;
}

export interface TelemetryPayloadV1 {
  readings: TelemetryReadingV1;
  status: TelemetryStatusV1;
  capabilities?: TelemetryCapabilitiesV1;
  siteId?: string;
  feederId?: string;
}

export interface TelemetryMessageV1 extends MessageEnvelope {
  messageType: 'telemetry';
  deviceType: DeviceType;
  payload: TelemetryPayloadV1;
}

export const telemetryPayloadSchemaV1: JsonSchema = {
  type: 'object',
  required: ['readings', 'status'],
  additionalProperties: false,
  properties: {
    readings: {
      type: 'object',
      required: ['powerKw'],
      additionalProperties: false,
      properties: {
        powerKw: { type: 'number' },
        energyKwh: { type: 'number', minimum: 0 },
        soc: { type: 'number', minimum: 0, maximum: 1 },
        voltageV: { type: 'number', minimum: 0 },
        currentA: { type: 'number' },
      },
    },
    status: {
      type: 'object',
      required: ['online'],
      additionalProperties: false,
      properties: {
        online: { type: 'boolean' },
        faultCode: { type: 'string', minLength: 1 },
      },
    },
    capabilities: {
      type: 'object',
      required: [],
      additionalProperties: false,
      properties: {
        maxChargeKw: { type: 'number', minimum: 0 },
        maxDischargeKw: { type: 'number', minimum: 0 },
        maxExportKw: { type: 'number', minimum: 0 },
        maxImportKw: { type: 'number', minimum: 0 },
      },
    },
    siteId: { type: 'string', minLength: 1 },
    feederId: { type: 'string', minLength: 1 },
  },
};

export const telemetryMessageSchemaV1: JsonSchema = {
  type: 'object',
  required: ['v', 'messageType', 'messageId', 'deviceId', 'deviceType', 'timestampMs', 'payload'],
  additionalProperties: false,
  properties: {
    v: { type: 'integer', minimum: 1 },
    messageType: { type: 'string', enum: ['telemetry'] },
    messageId: { type: 'string', format: 'uuid' },
    deviceId: { type: 'string', minLength: 1 },
    deviceType: { type: 'string', enum: ['pv', 'battery', 'ev'] },
    timestampMs: { type: 'integer', minimum: 0 },
    sentAtMs: { type: 'integer', minimum: 0 },
    correlationId: { type: 'string', minLength: 1 },
    source: { type: 'string', enum: ['simulator', 'pi-agent', 'backend', 'unknown'] },
    payload: telemetryPayloadSchemaV1,
  },
};
