import { validateWithSchema } from './schemaValidator';
import { contractVersion, envelopeSchema, isSupportedVersion, MessageEnvelope } from './envelope';
import {
  telemetryMessageSchemaV1,
  telemetryPayloadSchemaV1,
  TelemetryMessageV1,
  TelemetryPayloadV1,
} from './telemetry.v1';
import {
  SetpointMessageV1,
  SetpointPayloadV1,
  setpointMessageSchemaV1,
  setpointPayloadSchemaV1,
} from './setpoint.v1';

export {
  contractVersion,
  envelopeSchema,
  isSupportedVersion,
  telemetryMessageSchemaV1,
  telemetryPayloadSchemaV1,
  setpointMessageSchemaV1,
  setpointPayloadSchemaV1,
};

export type { MessageEnvelope, TelemetryMessageV1, TelemetryPayloadV1, SetpointMessageV1, SetpointPayloadV1 };

export class ContractValidationError extends Error {
  constructor(message: string, public details?: string[]) {
    super(message);
    this.name = 'ContractValidationError';
  }
}

export function validateEnvelope(value: unknown, lenient = false): MessageEnvelope {
  const res = validateWithSchema<MessageEnvelope>(envelopeSchema, value, lenient);
  if (!res.success || !res.value) {
    throw new ContractValidationError('Envelope validation failed', res.errors);
  }
  if (!isSupportedVersion((res.value as MessageEnvelope).v)) {
    throw new ContractValidationError('Unsupported message version', [`v=${(res.value as MessageEnvelope).v}`]);
  }
  return res.value as MessageEnvelope;
}

export function validateTelemetryMessage(value: unknown, lenient = false): TelemetryMessageV1 {
  const res = validateWithSchema<TelemetryMessageV1>(telemetryMessageSchemaV1, value, lenient);
  if (!res.success || !res.value) {
    throw new ContractValidationError('Telemetry validation failed', res.errors);
  }
  if (!isSupportedVersion((res.value as TelemetryMessageV1).v)) {
    throw new ContractValidationError('Unsupported message version', [`v=${(res.value as TelemetryMessageV1).v}`]);
  }
  return res.value as TelemetryMessageV1;
}

export function validateTelemetryPayload(value: unknown, lenient = false): TelemetryPayloadV1 {
  const res = validateWithSchema<TelemetryPayloadV1>(telemetryPayloadSchemaV1, value, lenient);
  if (!res.success || !res.value) {
    throw new ContractValidationError('Telemetry payload validation failed', res.errors);
  }
  return res.value as TelemetryPayloadV1;
}

export function validateSetpointMessage(value: unknown, lenient = false): SetpointMessageV1 {
  const res = validateWithSchema<SetpointMessageV1>(setpointMessageSchemaV1, value, lenient);
  if (!res.success || !res.value) {
    throw new ContractValidationError('Setpoint validation failed', res.errors);
  }
  if (!isSupportedVersion((res.value as SetpointMessageV1).v)) {
    throw new ContractValidationError('Unsupported message version', [`v=${(res.value as SetpointMessageV1).v}`]);
  }
  return res.value as SetpointMessageV1;
}

export function validateSetpointPayload(value: unknown, lenient = false): SetpointPayloadV1 {
  const res = validateWithSchema<SetpointPayloadV1>(setpointPayloadSchemaV1, value, lenient);
  if (!res.success || !res.value) {
    throw new ContractValidationError('Setpoint payload validation failed', res.errors);
  }
  return res.value as SetpointPayloadV1;
}
