import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { Buffer } from 'node:buffer';

import config from '../src/config';
import logger from '../src/logger';
import { handleTelemetryMessage } from '../src/mqttClient';
import { TelemetryHandler } from '../src/messaging/telemetryHandler';

const telemetryTopic = `${config.mqtt.topicPrefix}/telemetry/device-1`;

describe('mqttClient telemetry guards', () => {
  const originalMaxPayload = config.mqtt.maxPayloadBytes;
  const originalTimeout = config.mqtt.processingTimeoutMs;

  afterEach(() => {
    mock.restoreAll();
    config.mqtt.maxPayloadBytes = originalMaxPayload;
    config.mqtt.processingTimeoutMs = originalTimeout;
  });

  it('drops payloads that exceed configured size', async () => {
    config.mqtt.maxPayloadBytes = 5;
    const warnSpy = mock.method(logger, 'warn');
    const handleSpy = mock.method(TelemetryHandler.prototype as any, 'handle', async () => ({
      parsed: null,
      newest: false,
      status: 'inserted',
    }));

    await handleTelemetryMessage(telemetryTopic, Buffer.alloc(50, 'a'));

    assert.strictEqual(handleSpy.mock.callCount(), 0);
    assert.ok(warnSpy.mock.callCount() > 0, 'payload drop should be logged');
  });

  it('rejects telemetry that exceeds processing budget', async () => {
    config.mqtt.processingTimeoutMs = 10;
    config.mqtt.maxPayloadBytes = 1000;
    mock.method(TelemetryHandler.prototype as any, 'handle', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { parsed: null, newest: false, status: 'inserted' } as any;
    });

    const errorSpy = mock.method(logger, 'error');
    await handleTelemetryMessage(telemetryTopic, Buffer.from('{}'));

    assert.ok(errorSpy.mock.callCount() > 0, 'processing timeout should be reported');
  });
});
