import { query } from '../db';

export interface Device {
  id: string;
  type: string;
  siteId: string;
  pMaxKw: number;
  priority?: number | null;
  isPhysical?: boolean | null;
}

export function isPhysicalDeviceId(id: string): boolean {
  return id.startsWith('pi-');
}

export async function getDeviceById(id: string): Promise<Device | null> {
  const text = `
    SELECT id, type, site_id AS "siteId", p_max_kw AS "pMaxKw", priority, is_physical AS "isPhysical"
    FROM devices
    WHERE id = $1
    LIMIT 1;
  `;
  const { rows } = await query<Device>(text, [id]);
  return rows[0] ?? null;
}

export async function upsertDevice(device: Device): Promise<void> {
  const text = `
    INSERT INTO devices (id, type, site_id, p_max_kw, priority, is_physical)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET
      type = EXCLUDED.type,
      site_id = EXCLUDED.site_id,
      p_max_kw = EXCLUDED.p_max_kw,
      priority = COALESCE(EXCLUDED.priority, devices.priority),
      is_physical = COALESCE(EXCLUDED.is_physical, devices.is_physical);
  `;
  await query(text, [
    device.id,
    device.type,
    device.siteId,
    device.pMaxKw,
    device.priority ?? null,
    device.isPhysical ?? isPhysicalDeviceId(device.id),
  ]);
}

export async function getAllDevices(): Promise<Device[]> {
  const text = `
    SELECT id, type, site_id AS "siteId", p_max_kw AS "pMaxKw", priority, is_physical AS "isPhysical"
    FROM devices
    ORDER BY id;
  `;
  const { rows } = await query<Device>(text);
  return rows;
}
