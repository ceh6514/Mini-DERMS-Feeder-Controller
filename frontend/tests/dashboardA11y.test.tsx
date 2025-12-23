import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar from '../src/components/layout/Sidebar.js';
import DeviceTable from '../src/components/devices/DeviceTable.js';
import DashboardError from '../src/components/dashboard/DashboardError.js';

describe('Dashboard accessibility affordances', () => {
  it('marks active navigation with aria attributes', () => {
    const markup = renderToStaticMarkup(<Sidebar active="grid" onChange={() => {}} />);

    assert.match(markup, /aria-label="Jump to Grid health"/);
    assert.match(markup, /aria-current="true"/);
    assert.match(markup, /aria-controls="grid-section"/);
  });

  it('exposes device filters and selection states for screen readers', () => {
    const markup = renderToStaticMarkup(
      <DeviceTable
        devices={[
          {
            id: 'dev-1',
            type: 'ev',
            siteId: 'site-1',
            feederId: 'feeder-1',
            pMaxKw: 5,
            priority: 1,
            latestTelemetry: {
              id: 1,
              device_id: 'dev-1',
              ts: new Date().toISOString(),
              type: 'ev',
              p_actual_kw: 1.2,
              p_setpoint_kw: 2,
              soc: 0.5,
              site_id: 'site-1',
              device_p_max_kw: 5,
            },
            isPi: true,
            isSimulated: false,
            isPhysical: true,
          },
        ]}
        metrics={[
          {
            deviceId: 'dev-1',
            type: 'ev',
            siteId: 'site-1',
            feederId: 'feeder-1',
            avgAbsError: 0.1,
            lastSetpointKw: 2,
            lastActualKw: 1.2,
            priority: 1,
            soc: 0.5,
            isPhysical: true,
          },
        ]}
        selectedId="dev-1"
        onSelect={() => {}}
        filter="all"
        onFilter={() => {}}
      />,
    );

    assert.match(markup, /aria-pressed="true"/);
    assert.match(markup, /role="grid"/);
    assert.match(markup, /aria-selected="true"/);
  });

  it('surfaces retryable dashboard errors to assistive tech', () => {
    const markup = renderToStaticMarkup(
      <DashboardError title="Test load" message="Something went wrong" onRetry={() => {}} />,
    );

    assert.match(markup, /role="alert"/);
    assert.match(markup, /Retry loading Test load/);
  });
});
