#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const artifactsDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('artifacts/demo-run');
const metricsPath = path.join(artifactsDir, 'metrics.txt');
const healthPath = path.join(artifactsDir, 'health.json');
const runtimePath = path.join(artifactsDir, 'runtime.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return undefined;
  }
}

function loadMetrics() {
  if (!fs.existsSync(metricsPath)) return '';
  return fs.readFileSync(metricsPath, 'utf-8');
}

const metricsText = loadMetrics();

function sumPromMetric(name) {
  if (!metricsText) return 0;
  const regex = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)$`, 'gm');
  let match;
  let sum = 0;
  while ((match = regex.exec(metricsText)) !== null) {
    sum += Number(match[1]);
  }
  return sum;
}

function singlePromMetric(name) {
  if (!metricsText) return undefined;
  const regex = new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)$`, 'm');
  const match = regex.exec(metricsText);
  return match ? Number(match[1]) : undefined;
}

const runtime = readJson(runtimePath) || {};
const health = readJson(healthPath) || {};

const setpointPublishes = sumPromMetric('derms_setpoint_publish_total');
const setpointAcks = sumPromMetric('derms_setpoint_ack_total');
const deviceSeen = singlePromMetric('derms_devices_seen');
const deviceStale = singlePromMetric('derms_devices_stale');
const staleDeviceRate = deviceSeen && deviceSeen > 0 ? Number((deviceStale || 0) / deviceSeen) : undefined;
const controlLag = singlePromMetric('derms_control_cycle_interval_lag_seconds');
const controlCycleCount = sumPromMetric('derms_control_cycle_duration_seconds_count');

const publishSuccessRate = setpointPublishes > 0 ? setpointAcks / setpointPublishes : undefined;
const e2eResult = (health.status === 'ok' || health.ok === true) && (publishSuccessRate === undefined || publishSuccessRate >= 0.5)
  ? 'pass'
  : 'unknown';

const summary = {
  sha: runtime.gitSha || process.env.GITHUB_SHA || 'unknown',
  startedAt: runtime.startedAt || new Date().toISOString(),
  durationSec: runtime.durationSec || Number(process.env.DEMO_DURATION_SEC || 0),
  e2eResult,
  publishSuccessRate: publishSuccessRate === undefined ? null : Number(publishSuccessRate.toFixed(3)),
  staleDeviceRate: staleDeviceRate === undefined ? null : Number(staleDeviceRate.toFixed(3)),
  cycleCount: controlCycleCount || 0,
  maxLagSec: controlLag === undefined ? null : Number(controlLag.toFixed(3)),
  topicPrefix: runtime.topicPrefix || process.env.MQTT_TOPIC_PREFIX || 'unknown',
};

fs.mkdirSync(artifactsDir, { recursive: true });

fs.writeFileSync(path.join(artifactsDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const markdown = `# Demo scenario summary\n\n- **Commit**: ${summary.sha}\n- **Started**: ${summary.startedAt}\n- **Duration**: ${summary.durationSec || 'n/a'} sec\n- **Topic prefix**: ${summary.topicPrefix}\n- **Cycle count**: ${summary.cycleCount}\n- **Max interval lag (s)**: ${summary.maxLagSec ?? 'n/a'}\n- **Publish success rate**: ${summary.publishSuccessRate ?? 'n/a'}\n- **Stale device rate**: ${summary.staleDeviceRate ?? 'n/a'}\n- **Overall result**: ${summary.e2eResult}\n\nMetrics snapshot: [metrics.txt](./metrics.txt)\n`;

fs.writeFileSync(path.join(artifactsDir, 'summary.md'), markdown);

console.log(`[demo] Wrote summary to ${path.join(artifactsDir, 'summary.json')}`);
