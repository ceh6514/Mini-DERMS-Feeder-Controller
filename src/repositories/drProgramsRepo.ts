import { query } from '../db';

export type DrProgramMode = 'fixed_cap' | 'price_elastic';

export interface DrProgramRow {
  id: number;
  name: string;
  mode: DrProgramMode;
  ts_start: Date;
  ts_end: Date;
  target_shed_kw: number | null;
  incentive_per_kwh: number | null;
  penalty_per_kwh: number | null;
  is_active: boolean;
}

export interface DrProgramInput {
  name: string;
  mode: DrProgramMode;
  tsStart: Date;
  tsEnd: Date;
  targetShedKw?: number | null;
  incentivePerKwh?: number | null;
  penaltyPerKwh?: number | null;
  isActive?: boolean;
}

export async function listDrPrograms(): Promise<DrProgramRow[]> {
  const text = `
    SELECT id, name, mode, ts_start, ts_end, target_shed_kw, incentive_per_kwh, penalty_per_kwh, is_active
    FROM dr_programs
    ORDER BY ts_start DESC, id DESC;
  `;
  const { rows } = await query<DrProgramRow>(text);
  return rows;
}

export async function getDrProgram(id: number): Promise<DrProgramRow | null> {
  const text = `
    SELECT id, name, mode, ts_start, ts_end, target_shed_kw, incentive_per_kwh, penalty_per_kwh, is_active
    FROM dr_programs
    WHERE id = $1
    LIMIT 1;
  `;
  const { rows } = await query<DrProgramRow>(text, [id]);
  return rows[0] ?? null;
}

export async function createDrProgram(input: DrProgramInput): Promise<DrProgramRow> {
  const text = `
    INSERT INTO dr_programs (name, mode, ts_start, ts_end, target_shed_kw, incentive_per_kwh, penalty_per_kwh, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, name, mode, ts_start, ts_end, target_shed_kw, incentive_per_kwh, penalty_per_kwh, is_active;
  `;
  const params = [
    input.name,
    input.mode,
    input.tsStart,
    input.tsEnd,
    input.targetShedKw ?? 0,
    input.incentivePerKwh ?? 0,
    input.penaltyPerKwh ?? 0,
    input.isActive ?? false,
  ];
  const { rows } = await query<DrProgramRow>(text, params);
  return rows[0];
}

export async function updateDrProgram(
  id: number,
  input: Partial<DrProgramInput>,
): Promise<DrProgramRow | null> {
  const existing = await getDrProgram(id);
  if (!existing) return null;

  const text = `
    UPDATE dr_programs
    SET name = $1,
        mode = $2,
        ts_start = $3,
        ts_end = $4,
        target_shed_kw = $5,
        incentive_per_kwh = $6,
        penalty_per_kwh = $7,
        is_active = $8
    WHERE id = $9
    RETURNING id, name, mode, ts_start, ts_end, target_shed_kw, incentive_per_kwh, penalty_per_kwh, is_active;
  `;

  const params = [
    input.name ?? existing.name,
    input.mode ?? existing.mode,
    input.tsStart ?? existing.ts_start,
    input.tsEnd ?? existing.ts_end,
    input.targetShedKw ?? existing.target_shed_kw,
    input.incentivePerKwh ?? existing.incentive_per_kwh,
    input.penaltyPerKwh ?? existing.penalty_per_kwh,
    input.isActive ?? existing.is_active,
    id,
  ];

  const { rows } = await query<DrProgramRow>(text, params);
  return rows[0] ?? null;
}

export async function deleteDrProgram(id: number): Promise<boolean> {
  const text = `DELETE FROM dr_programs WHERE id = $1;`;
  await query(text, [id]);
  return true;
}

export async function activateDrProgram(id: number): Promise<DrProgramRow | null> {
  const existing = await getDrProgram(id);
  if (!existing) return null;

  await query(`UPDATE dr_programs SET is_active = FALSE WHERE is_active = TRUE;`);
  const text = `
    UPDATE dr_programs
    SET is_active = TRUE
    WHERE id = $1
    RETURNING id, name, mode, ts_start, ts_end, target_shed_kw, incentive_per_kwh, penalty_per_kwh, is_active;
  `;
  const { rows } = await query<DrProgramRow>(text, [id]);
  return rows[0] ?? null;
}

export async function deactivateProgram(id: number): Promise<void> {
  await query(`UPDATE dr_programs SET is_active = FALSE WHERE id = $1;`, [id]);
}

export async function getActiveDrProgram(now: Date): Promise<DrProgramRow | null> {
  const text = `
    SELECT id, name, mode, ts_start, ts_end, target_shed_kw, incentive_per_kwh, penalty_per_kwh, is_active
    FROM dr_programs
    WHERE is_active = TRUE AND ts_start <= $1 AND ts_end >= $1
    ORDER BY ts_start DESC
    LIMIT 1;
  `;
  const { rows } = await query<DrProgramRow>(text, [now]);
  return rows[0] ?? null;
}
