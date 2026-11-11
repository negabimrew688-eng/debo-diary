import { query } from '../config/db.js';
import { round } from '../utils/num.js';

/** Rule-of-thumb concentrate need (kg/day) for a cow, based on daily milk yield. */
export function concentrateKgPerDay(cow) {
  if (!cow.lactating) return 1; // maintenance/dry-cow supplement
  const y = Number(cow.daily_yield_litres) || 0;
  return round(Math.min(Math.max((y - 4) * 0.4, 1), 8), 1);
}
export function proteinTarget(cow) {
  if (!cow.lactating) return 12;
  const y = Number(cow.daily_yield_litres) || 0;
  return y >= 10 ? 18 : y >= 6 ? 16 : 14;
}

/**
 * AI-assisted (rule-based) ration advice: per cow, pick the cheapest in-stock concentrate that meets the protein target,
 * and report daily cost and cost per litre. Advisory only; not a veterinary or nutritionist prescription.
 */
export async function recommendFeed(farmerId) {
  const { rows: cows } = await query('SELECT * FROM cows WHERE farmer_id=$1 ORDER BY tag', [farmerId]);
  const { rows: products } = await query(
    `SELECT p.*, sp.business_name FROM feed_products p
       LEFT JOIN supplier_profiles sp ON sp.user_id = p.supplier_id
      WHERE p.active AND p.stock_kg > 0 AND p.category IN ('concentrate','by_product')`
  );
  const { rows: recent } = await query(
    `SELECT t.grade, t.fat_percent FROM milk_tests t JOIN milk_batches b ON b.id=t.batch_id
      WHERE b.farmer_id=$1 AND t.test_type='producer' ORDER BY t.created_at DESC LIMIT 5`,
    [farmerId]
  );

  const plans = cows.map((cow) => {
    const kg = concentrateKgPerDay(cow);
    const target = proteinTarget(cow);
    const eligible = products.filter((p) => p.protein_percent !== null && p.protein_percent >= target);
    const pool = eligible.length ? eligible : [...products].sort((a, b) => (b.protein_percent ?? 0) - (a.protein_percent ?? 0)).slice(0, 1);
    const best = [...pool].sort((a, b) => a.price_per_kg - b.price_per_kg)[0] || null;
    const dailyCost = best ? round(best.price_per_kg * kg, 2) : null;
    return {
      cow_id: cow.id, tag: cow.tag, lactating: cow.lactating, daily_yield_litres: cow.daily_yield_litres,
      concentrate_kg_per_day: kg, protein_target_percent: target,
      meets_target: !!best && eligible.length > 0,
      product: best && { id: best.id, name: best.name, price_per_kg: best.price_per_kg, protein_percent: best.protein_percent, supplier: best.business_name, stock_kg: best.stock_kg },
      daily_cost: dailyCost,
      cost_per_litre: dailyCost && cow.daily_yield_litres > 0 ? round(dailyCost / cow.daily_yield_litres, 2) : null,
    };
  });

  const tips = [];
  const lowFat = recent.filter((r) => r.fat_percent !== null && r.fat_percent < 3.2).length;
  if (lowFat >= 2) tips.push('Milk fat has been low in recent tests. Increase good-quality roughage (hay, silage) and check mineral supply.');
  const fails = recent.filter((r) => r.grade === 'FAIL').length;
  if (fails >= 1) tips.push('Recent batches failed the water check. Use clean, dry containers and re-test before listing; failed milk cannot be sold.');
  if (cows.some((c) => c.lactating && c.daily_yield_litres > 0 && c.daily_yield_litres < 5)) {
    tips.push('Some lactating cows give under 5 litres a day. Check water access, feed energy and cow health; ask a veterinarian if it persists.');
  }
  if (!cows.length) tips.push('Register your cows to get a personal feed plan.');

  return {
    plans,
    weekly_total_kg: round(plans.reduce((s, p) => s + p.concentrate_kg_per_day * 7, 0), 1),
    tips,
    disclaimer: 'Rule-based guidance for planning. It is not a veterinary or nutritionist prescription.',
  };
}
