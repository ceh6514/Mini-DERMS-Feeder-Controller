import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Dashboard from '../src/pages/Dashboard.js';
import Login from '../src/pages/Login.js';

const loginMock = vi.fn();
const logoutMock = vi.fn();
const setSelectedIdMock = vi.fn();
const liveMetricsMock = vi.fn();
const fetchFeedersMock = vi.fn();
const fetchDeviceTelemetryMock = vi.fn();

const baseDevices = [
  {
    id: 'dev-phys',
    type: 'ev',
    siteId: 'site-1',
    feederId: 'feeder-1',
    pMaxKw: 5,
    priority: 1,
    latestTelemetry: null,
    isPi: false,
    isSimulated: false,
    isPhysical: true,
  },
  {
    id: 'dev-sim',
    type: 'ev',
    siteId: 'site-2',
    feederId: 'feeder-2',
    pMaxKw: 5,
    priority: 1,
    latestTelemetry: null,
    isPi: false,
    isSimulated: true,
    isPhysical: false,
  },
];

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
  default: ({ devices, onFilter, onSelect, filter }: any) => (
    <div>
      <div data-testid="grid-devices">{(devices || []).map((d: any) => d.id).join(',')}</div>
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

vi.mock('../src/components/dashboard/GenerationSection', () => ({ default: () => <div>generation</div> }));
vi.mock('../src/components/dashboard/ConsumptionSection', () => ({ default: () => <div>consumption</div> }));
vi.mock('../src/components/dashboard/ForecastSection', () => ({ default: () => <div>forecast</div> }));
vi.mock('../src/components/dashboard/DeviceDetailSection', () => ({ default: () => <div>device detail</div> }));
vi.mock('../src/components/dashboard/ControlsSection', () => ({ default: () => <div>controls</div> }));
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
  liveMetricsMock.mockImplementation((feederId?: string) => {
    const devices = feederId ? baseDevices.filter((d) => d.feederId === feederId) : baseDevices;
    return {
      summary: null,
      devices,
      health: null,
      history: [],
      tracking: devices.map((d) => ({
        deviceId: d.id,
        type: d.type,
        siteId: d.siteId,
        feederId: d.feederId,
        avgAbsError: 0,
        lastSetpointKw: 0,
        lastActualKw: 0,
        priority: d.priority,
        soc: null,
        isPhysical: d.isPhysical,
      })),
      aggregated: null,
      loading: false,
      error: null,
    } as any;
  });
});

describe('Login interactions', () => {
  it('submits credentials to the auth provider', async () => {
    const user = userEvent.setup();
    render(<Login />);

    await user.type(screen.getByPlaceholderText('admin'), 'operator');
    await user.type(screen.getByPlaceholderText('••••••'), 'secret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(loginMock).toHaveBeenCalledWith('operator', 'secret');
  });

  it('surfaces login failures', async () => {
    loginMock.mockRejectedValueOnce(new Error('bad creds'));
    const user = userEvent.setup();
    render(<Login />);

    await user.type(screen.getByPlaceholderText('admin'), 'operator');
    await user.type(screen.getByPlaceholderText('••••••'), 'secret');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/bad creds/)).toBeInTheDocument();
  });
});

describe('Dashboard interactions', () => {
  it('filters live metrics by feeder selection', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    const select = await screen.findByLabelText('feeder-select');
    await waitFor(() => expect(liveMetricsMock).toHaveBeenCalled());
    liveMetricsMock.mockClear();

    await user.selectOptions(select, 'feeder-2');

    await waitFor(() => {
      expect(liveMetricsMock).toHaveBeenCalled();
      const [feederArg] = liveMetricsMock.mock.calls[liveMetricsMock.mock.calls.length - 1];
      expect(feederArg).toBe('feeder-2');
    });
    expect(screen.getByTestId('grid-devices').textContent).toContain('dev-sim');
  });

  it('allows toggling device filters and selection', async () => {
    const user = userEvent.setup();
    render(<Dashboard />);

    await screen.findByLabelText('feeder-select');

    await user.click(screen.getByLabelText('filter-physical'));
    expect(screen.getByTestId('grid-devices').textContent).toContain('dev-phys');
    expect(screen.getByTestId('grid-devices').textContent).not.toContain('dev-sim');

    await user.click(screen.getByLabelText('filter-simulated'));
    expect(screen.getByTestId('grid-devices').textContent).toContain('dev-sim');

    await user.click(screen.getByLabelText('select-first'));
    expect(setSelectedIdMock).toHaveBeenCalledWith('dev-sim');
  });
});