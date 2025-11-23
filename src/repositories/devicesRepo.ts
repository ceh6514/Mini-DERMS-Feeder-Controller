import { query } from '../db';

export interface Device {
  id: string;
  type: string;
  siteId: string;
  pMaxKw: number;
}

export async function upsertDevice(device: Device): Promise<void> {
  const text = `
    INSERT INTO devices (id, type, site_id, p_max_kw)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET
      type = EXCLUDED.type,
      site_id = EXCLUDED.site_id,
      p_max_kw = EXCLUDED.p_max_kw;
  `;
  await query(text, [device.id, device.type, device.siteId, device.pMaxKw]);
}

export async function getAllDevices(): Promise<Device[]> {
  const text = `
    SELECT id, type, site_id AS "siteId", p_max_kw AS "pMaxKw"
    FROM devices
    ORDER BY id;
  `;
  const { rows } = await query<Device>(text);
  return rows;
}
