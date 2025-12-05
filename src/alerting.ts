import http from 'node:http';
import https from 'node:https';
import { ControlLoopStateSnapshot, OfflineDeviceInfo } from './state/controlLoopMonitor';

const webhookUrl = process.env.ALERT_WEBHOOK_URL;

function postWebhook(message: string, payload: Record<string, unknown>) {
  if (!webhookUrl) {
    console.info('[alerting] webhook not configured; skipping alert:', message);
    return;
  }

  try {
    const url = new URL(webhookUrl);
    const body = JSON.stringify({ message, ...payload });
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        console.error('[alerting] webhook responded with error', res.statusCode);
      }
    });

    req.on('error', (err) => {
      console.error('[alerting] failed to send webhook', err);
    });

    req.write(body);
    req.end();
  } catch (err) {
    console.error('[alerting] failed to construct webhook request', err);
  }
}

export function notifyOfflineDevices(devices: OfflineDeviceInfo[]): void {
  if (devices.length === 0) return;

  const summary = devices.map((d) => `${d.deviceId} (last at ${d.lastHeartbeat})`).join(', ');
  console.warn('[alerting] offline devices detected:', summary);
  postWebhook('Devices offline', { devices });
}

export function notifyStalledLoop(state: ControlLoopStateSnapshot): void {
  console.warn('[alerting] control loop stalled', state);
  postWebhook('Control loop stalled', state);
}
