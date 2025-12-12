import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { observeHistogram, renderPrometheus, resetMetricsForTest, setGaugeValue } from '../src/observability/metrics';

describe('custom metrics rendering', () => {
  beforeEach(() => resetMetricsForTest());

  it('renders labeled histograms and gauges', () => {
    observeHistogram('derms_device_allocated_kw', 5, { deviceType: 'ev' });
    observeHistogram('derms_device_allocated_kw', 2, { deviceType: 'battery' });
    setGaugeValue('derms_devices_seen', 3);

    const metrics = renderPrometheus();

    assert.ok(metrics.includes('derms_device_allocated_kw_bucket{deviceType="ev",le="5"} 1'));
    assert.ok(metrics.includes('derms_device_allocated_kw_count{deviceType="battery"} 1'));
    assert.ok(metrics.includes('derms_devices_seen 3'));
  });
});
