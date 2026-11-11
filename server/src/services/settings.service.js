import { query } from '../config/db.js';

export const DEFAULT_SETTINGS = {
  // Pricing (ETB per litre). Placeholder: admins must set the real local reference price.
  base_price_per_litre: 50,
  grade_multipliers: { A: 1.0, B: 0.85 },
  fat_bonus_per_point: 0.03, // +3% of price per fat point above 3.5%, capped below
  fat_bonus_cap: 0.1,
  // Grading thresholds on estimated added-water percent
  grade_a_max_water: 5,
  grade_b_max_water: 15,
  // Milk Check model baselines (cow milk). Calibrate with real samples.
  normal_clr: 29, // corrected lactometer reading of undiluted cow milk at the standard temperature
  normal_snf: 8.5, // % solids-not-fat of undiluted cow milk
  normal_conductivity_ms: 4.5,
  standard_temp_c: 20,
  temp_coeff: 0.2, // CLR points per degree C
  // Delivery check: grade must match, or water estimate must be within this many points of the test at listing
  delivery_tolerance_points: 3,
  // Delivery partner fee per completed delivery (ETB). Placeholder: set the real local rate.
  delivery_fee_etb: 80,
  // Estimated platform commission on completed sales (%). Placeholder for revenue reporting, not charged anywhere yet.
  platform_commission_percent: 3,
  // Fitted calibration (written by the admin calibration endpoint): { slope, intercept, n, rmse } or null
  calibration: null,
};

export async function getSettings() {
  const { rows } = await query('SELECT key, value FROM system_settings');
  const merged = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = r.value;
  return merged;
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO system_settings(key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, JSON.stringify(value)]
  );
}
