import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  observeHistogram,
  renderPrometheus,
  resetMetricsForTest,
  setGaugeValue,
} from '../src/observability/metrics';

function parseMetricValue(lines: string[], name: string, labels: Record<string, string> = {}): number {
  const labelString = Object.keys(labels)
    .sort()
    .map((key) => `${key}="${labels[key]}"`)
    .join(',');
  const suffix = labelString ? `{${labelString}}` : '';
  const line = lines.find((l) => l.startsWith(`${name}${suffix} `));
  assert.ok(line, `expected to find metric ${name}${suffix}`);
  return Number(line.split(' ')[1]);
}

describe('custom metrics rendering', () => {
  beforeEach(() => resetMetricsForTest());

  it('renders labeled histograms and gauges', () => {
    observeHistogram('derms_device_allocated_kw', 5, { deviceType: 'ev' });
    observeHistogram('derms_device_allocated_kw', 2, { deviceType: 'battery' });
    setGaugeValue('derms_devices_seen', 3);

    const metrics = renderPrometheus();
    const lines = metrics.trim().split('\n');

    assert.ok(
      lines.includes('derms_device_allocated_kw_bucket{deviceType="ev",le="5"} 1'),
    );
    assert.ok(
      lines.includes('derms_device_allocated_kw_count{deviceType="battery"} 1'),
    );
    assert.ok(lines.includes('derms_devices_seen 3'));
  });

  it('renders histogram buckets in order with consistent totals', () => {
    observeHistogram('derms_device_allocated_kw', 0.4, { deviceType: 'ev' });
    observeHistogram('derms_device_allocated_kw', 1.2, { deviceType: 'ev' });

    const metrics = renderPrometheus();
    const lines = metrics.trim().split('\n');

    const expectedBuckets = [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100];
    const expectedCumulative = [0, 1, 2, 4, 6, 8, 10, 12, 14];

    const evBucketLines = lines.filter((line) =>
      line.startsWith('derms_device_allocated_kw_bucket{deviceType="ev",'),
    );
    const expectedBucketLines = expectedBuckets.map(
      (bucket, idx) =>
        `derms_device_allocated_kw_bucket{deviceType="ev",le="${bucket}"} ${expectedCumulative[idx]}`,
    );

    assert.deepEqual(
      evBucketLines.slice(0, expectedBuckets.length),
      expectedBucketLines,
      'bucket order and cumulative counts should match expected thresholds',
    );

    const infLine = 'derms_device_allocated_kw_bucket{deviceType="ev",le="+Inf"} 2';
    assert.equal(evBucketLines[expectedBuckets.length], infLine);

    const sum = parseMetricValue(lines, 'derms_device_allocated_kw_sum', {
      deviceType: 'ev',
    });
    const count = parseMetricValue(lines, 'derms_device_allocated_kw_count', {
      deviceType: 'ev',
    });

    const expectedObservations = 2;

    assert.equal(sum, 1.6);
    assert.equal(count, expectedObservations);
    assert.equal(
      Number(infLine.split(' ')[1]),
      count,
      'the +Inf bucket should reflect total observation count',
    );
  });
});
