import { useEffect, useMemo, useState } from 'react';
import {
  activateDrProgram,
  createDrProgram,
  deleteDrProgram,
  fetchActiveDrProgramImpact,
  fetchDrPrograms,
} from '../api/client';
import { DrImpactSnapshot, DrProgram, DrProgramMode } from '../api/types';

interface FormState {
  name: string;
  mode: DrProgramMode;
  tsStart: string;
  tsEnd: string;
  targetShedKw: string;
  incentivePerKwh: string;
  penaltyPerKwh: string;
  isActive: boolean;
}

const defaultFormState: FormState = {
  name: '',
  mode: 'fixed_cap',
  tsStart: '',
  tsEnd: '',
  targetShedKw: '5',
  incentivePerKwh: '0',
  penaltyPerKwh: '0',
  isActive: false,
};

function formatDateInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function describeProgram(program: DrProgram): string {
  const start = new Date(program.ts_start).toLocaleString();
  const end = new Date(program.ts_end).toLocaleString();
  return `${program.name} • ${program.mode === 'fixed_cap' ? 'Fixed cap' : 'Price elastic'} • ${start} → ${end}`;
}

function computeStatus(program: DrProgram): 'active' | 'upcoming' | 'ended' {
  const now = Date.now();
  const start = new Date(program.ts_start).getTime();
  const end = new Date(program.ts_end).getTime();
  if (program.is_active && start <= now && end >= now) return 'active';
  if (end < now) return 'ended';
  return 'upcoming';
}

const DrProgramPanel = () => {
  const [form, setForm] = useState<FormState>(() => {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    return {
      ...defaultFormState,
      tsStart: formatDateInput(now),
      tsEnd: formatDateInput(end),
    };
  });
  const [programs, setPrograms] = useState<DrProgram[]>([]);
  const [impact, setImpact] = useState<DrImpactSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeProgramId = useMemo(
    () => programs.find((p) => p.is_active)?.id ?? null,
    [programs],
  );

  const refreshPrograms = async () => {
    try {
      setLoading(true);
      const [list, activeInfo] = await Promise.all([
        fetchDrPrograms(),
        fetchActiveDrProgramImpact(),
      ]);
      setPrograms(list);
      setImpact(activeInfo.impact ?? null);
    } catch (err) {
      console.error('Failed to refresh DR programs', err);
      setMessage('Unable to load DR programs');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshPrograms();
  }, []);

  const resetMessage = () => {
    setMessage(null);
    setMessageType(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    resetMessage();

    if (!form.name.trim()) {
      setMessage('Name is required');
      setMessageType('error');
      return;
    }

    if (!form.tsStart || !form.tsEnd) {
      setMessage('Start and end time are required');
      setMessageType('error');
      return;
    }

    const startDate = new Date(form.tsStart);
    const endDate = new Date(form.tsEnd);

    if (startDate >= endDate) {
      setMessage('End time must be after start time');
      setMessageType('error');
      return;
    }

    setSubmitting(true);
    try {
      await createDrProgram({
        name: form.name.trim(),
        mode: form.mode,
        tsStart: startDate.toISOString(),
        tsEnd: endDate.toISOString(),
        targetShedKw: Number(form.targetShedKw) || 0,
        incentivePerKwh: Number(form.incentivePerKwh) || 0,
        penaltyPerKwh: Number(form.penaltyPerKwh) || 0,
        isActive: form.isActive,
      });
      setMessage('Program created');
      setMessageType('success');
      await refreshPrograms();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to create program';
      setMessage(text);
      setMessageType('error');
    } finally {
      setSubmitting(false);
    }
  };

  const activate = async (id: number) => {
    resetMessage();
    try {
      await activateDrProgram(id);
      setMessage('Program activated');
      setMessageType('success');
      await refreshPrograms();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to activate program';
      setMessage(text);
      setMessageType('error');
    }
  };

  const remove = async (id: number) => {
    resetMessage();
    try {
      await deleteDrProgram(id);
      setMessage('Program deleted');
      setMessageType('success');
      await refreshPrograms();
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Failed to delete program';
      setMessage(text);
      setMessageType('error');
    }
  };

  const renderImpact = () => {
    if (!impact) {
      return <p className="muted">No impact snapshot yet.</p>;
    }

    const shedLabel = impact.shedAppliedKw >= 0 ? 'Shed' : 'Boost';
    const shedValue = Math.abs(impact.shedAppliedKw).toFixed(2);
    const maxAvailable = Math.max(impact.availableBeforeKw, impact.availableAfterKw, 0.1);
    const beforePct = Math.min(100, (impact.availableBeforeKw / maxAvailable) * 100);
    const afterPct = Math.min(100, (impact.availableAfterKw / maxAvailable) * 100);

    return (
      <div className="dr-impact">
        <div className="dr-impact__stats">
          <div>
            <span className="label">Elasticity factor</span>
            <strong>{impact.elasticityFactor.toFixed(2)}</strong>
          </div>
          <div>
            <span className="label">{shedLabel}</span>
            <strong>{shedValue} kW</strong>
          </div>
          <div>
            <span className="label">Avg utilization</span>
            <strong>{impact.avgUtilizationPct.toFixed(1)}%</strong>
          </div>
          <div>
            <span className="label">Priority-weighted util.</span>
            <strong>{impact.priorityWeightedUtilizationPct.toFixed(1)}%</strong>
          </div>
        </div>
        <div className="dr-impact__bar">
          <div className="bar-label">Available for EVs</div>
          <div className="bar-shell">
            <div
              className="bar-actual"
              style={{ width: `${beforePct}%` }}
            >
              <span>Before: {impact.availableBeforeKw.toFixed(1)} kW</span>
            </div>
            <div
              className="bar-dr"
              style={{ width: `${afterPct}%` }}
            >
              <span>After DR: {impact.availableAfterKw.toFixed(1)} kW</span>
            </div>
          </div>
        </div>
        <div className="dr-impact__devices">
          {impact.perDevice.slice(0, 5).map((device) => (
            <div key={device.deviceId} className="dr-impact__device">
              <div>
                <strong>{device.deviceId}</strong>
                <span className="muted">Priority {device.priority}</span>
              </div>
              <div>
                <span className="pill">{device.allowedKw.toFixed(1)} kW</span>
                <span className="pill muted">{device.utilizationPct.toFixed(0)}% of {device.pMax.toFixed(1)} kW</span>
              </div>
            </div>
          ))}
          {impact.perDevice.length === 0 && <p className="muted">No EV allocations yet.</p>}
        </div>
      </div>
    );
  };

  return (
    <div className="card dr-program-panel">
      <div className="dr-program-header">
        <div>
          <h2>DR Programs</h2>
          <p className="muted">Create, activate, and observe demand-response strategies.</p>
        </div>
        <button className="ghost-button" onClick={refreshPrograms} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <form className="dr-program-form" onSubmit={handleSubmit}>
        <div className="field">
          <label>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Morning shed"
          />
        </div>
        <div className="field">
          <label>Mode</label>
          <select
            value={form.mode}
            onChange={(e) => setForm((prev) => ({ ...prev, mode: e.target.value as DrProgramMode }))}
          >
            <option value="fixed_cap">Fixed kW cap</option>
            <option value="price_elastic">Price-driven elasticity</option>
          </select>
        </div>
        <div className="field-row">
          <label>
            Start
            <input
              type="datetime-local"
              value={form.tsStart}
              onChange={(e) => setForm((prev) => ({ ...prev, tsStart: e.target.value }))}
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              value={form.tsEnd}
              onChange={(e) => setForm((prev) => ({ ...prev, tsEnd: e.target.value }))}
            />
          </label>
        </div>
        <div className="field-row">
          <label>
            Target shed (kW)
            <input
              type="number"
              step="0.1"
              value={form.targetShedKw}
              onChange={(e) => setForm((prev) => ({ ...prev, targetShedKw: e.target.value }))}
            />
          </label>
          <label>
            Incentive ($/kWh)
            <input
              type="number"
              step="0.01"
              value={form.incentivePerKwh}
              onChange={(e) => setForm((prev) => ({ ...prev, incentivePerKwh: e.target.value }))}
            />
          </label>
          <label>
            Penalty ($/kWh)
            <input
              type="number"
              step="0.01"
              value={form.penaltyPerKwh}
              onChange={(e) => setForm((prev) => ({ ...prev, penaltyPerKwh: e.target.value }))}
            />
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
          />
          Activate immediately
        </label>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save program'}
        </button>
      </form>

      {message && <div className={`notice ${messageType === 'error' ? 'error' : 'success'}`}>{message}</div>}

      <div className="dr-program-list">
        <div className="dr-program-list__header">
          <h3>Programs</h3>
          <span className="muted">{programs.length} configured</span>
        </div>
        {programs.length === 0 && <p className="muted">No programs yet.</p>}
        {programs.map((program) => {
          const status = computeStatus(program);
          const isActiveProgram = activeProgramId === program.id;
          return (
            <div key={program.id} className="dr-program-row">
              <div>
                <div className="dr-program-name">{program.name}</div>
                <div className="muted small-text">{describeProgram(program)}</div>
                <div className="pill-row">
                  <span className={`pill ${status === 'active' ? 'success' : 'muted'}`}>
                    {status}
                  </span>
                  <span className="pill muted">Target shed: {program.target_shed_kw?.toFixed(1) ?? 0} kW</span>
                  <span className="pill muted">
                    Incentive/penalty: {program.incentive_per_kwh?.toFixed(2) ?? '0.00'} /{' '}
                    {program.penalty_per_kwh?.toFixed(2) ?? '0.00'}
                  </span>
                </div>
              </div>
              <div className="dr-program-actions">
                {!isActiveProgram && (
                  <button className="primary" onClick={() => activate(program.id)}>
                    Activate
                  </button>
                )}
                {isActiveProgram && <span className="badge success">Active</span>}
                <button className="ghost-button" onClick={() => remove(program.id)}>
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="dr-impact-panel">
        <h3>Current impact</h3>
        {impact?.activeProgram ? (
          <div className="muted small-text">
            Active program: {describeProgram(impact.activeProgram)}
          </div>
        ) : (
          <div className="muted small-text">No active program</div>
        )}
        {renderImpact()}
      </div>
    </div>
  );
};

export default DrProgramPanel;
