import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../src/pages/Dashboard.js';

const loginMock = vi.fn();
const logoutMock = vi.fn();
const setSelectedIdMock = vi.fn();
const liveMetricsMock = vi.fn();
const fetchFeedersMock = vi.fn();
const fetchDeviceTelemetryMock = vi.fn();

vi.mock('../src/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { username: 'operator', role: 'operator' },
    login: loginMock,
    logout: logoutMock,
    loading: false,
  }),
}));

vi.mock('../src/hooks/useDayNightTheme', () => ({
  useDayNightTheme: () => 'day',
}));

vi.mock('../src/hooks/useDeviceSelection', () => ({
  useDeviceSelection: () => ({ selectedId: null, setSelectedId: setSelectedIdMock }),
}));

vi.mock('../src/hooks/useLiveMetrics', () => ({
  useLiveMetrics: (...args: unknown[]) => liveMetricsMock(...args),
}));

vi.mock('../src/api/client', () => ({
  fetchFeeders: (...args: unknown[]) => fetchFeedersMock(...args),
  fetchDeviceTelemetry: (...args: unknown[]) => fetchDeviceTelemetryMock(...args),
}));

vi.mock('../src/components/layout/LayoutShell', () => ({
  default: ({ feeders, selectedFeederId, onFeederChange, children }: any) => (
    <div>
      <label htmlFor="feeder-select">Feeder</label>
      <select
        id="feeder-select"
        aria-label="feeder-select"
        value={selectedFeederId ?? ''}
        onChange={(e) => onFeederChange?.(e.target.value)}
      >
        {feeders.map((f: any) => (
          <option key={f.feederId} value={f.feederId}>
            {f.feederId}
          </option>
        ))}
      </select>
      {children}
    </div>
  ),
}));

// FIX APPLIED HERE: Added (devices || []) check
vi.mock('../src/components/dashboard/GridHealthSection', () => ({
  default: ({ devices, onFilter, onSelect, filter, sectionRef }: any) => (
    <div ref={sectionRef} data-testid="grid-devices">
      {(devices || []).map((d: any) => d.id).join(',')}
      <button aria-label="filter-all" onClick={() => onFilter('all')}>
        All
      </button>
      <button aria-label="filter-physical" onClick={() => onFilter('physical')}>
        Physical
      </button>
      <button aria-label="filter-simulated" onClick={() => onFilter('simulated')}>
        Simulated
      </button>
      <button aria-label="select-first" onClick={() => onSelect(devices?.[0]?.id)}>
        Select first
      </button>
      <div data-testid="active-filter">{filter}</div>
    </div>
  ),
}));

vi.mock('../src/components/dashboard/GenerationSection', () => ({ default: ({ sectionRef }: any) => <div ref={sectionRef}>generation</div> }));
vi.mock('../src/components/dashboard/ConsumptionSection', () => ({ default: ({ sectionRef }: any) => <div ref={sectionRef}>consumption</div> }));
vi.mock('../src/components/dashboard/ForecastSection', () => ({ default: ({ sectionRef }: any) => <div ref={sectionRef}>forecast</div> }));
vi.mock('../src/components/dashboard/DeviceDetailSection', () => ({ default: ({ sectionRef }: any) => <div ref={sectionRef}>device detail</div> }));
vi.mock('../src/components/dashboard/ControlsSection', () => ({ default: ({ sectionRef }: any) => <div ref={sectionRef}>controls</div> }));
vi.mock('../src/components/layout/HeroStrip', () => ({ default: () => <div>hero</div> }));
vi.mock('../src/components/layout/OrganicDivider', () => ({ default: () => <div>divider</div> }));

beforeEach(() => {
  loginMock.mockReset();
  logoutMock.mockReset();
  setSelectedIdMock.mockReset();
  fetchFeedersMock.mockResolvedValue([
    { feederId: 'feeder-1', name: 'Feeder One' },
    { feederId: 'feeder-2', name: 'Feeder Two' },
  ]);
  fetchDeviceTelemetryMock.mockResolvedValue([]);
  liveMetricsMock.mockReturnValue({
    summary: null,
    devices: [],
    health: null,
    history: [],
    tracking: [],
    aggregated: null,
    loading: false,
    error: null,
  } as any);
});

describe('Dashboard snapshot', () => {
  it('matches the expected component tree', async () => {
    const { asFragment } = render(<Dashboard />);
    await screen.findByLabelText('feeder-select');
    expect(asFragment()).toMatchSnapshot();
  });
});