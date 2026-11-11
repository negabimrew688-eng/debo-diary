import { query } from '../config/db.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Delivery partners currently Available (used by buyers and admins to pick one manually). */
export const availableTransporters = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.region, u.fayda_verified AS verified, tp.company_name, tp.vehicle_type, tp.capacity_litres, tp.has_cold_storage, tp.service_area
       FROM transporter_profiles tp JOIN users u ON u.id=tp.user_id WHERE u.is_active AND tp.availability_status='available' ORDER BY tp.has_cold_storage DESC, u.full_name`);
  res.json({ transporters: rows });
});
