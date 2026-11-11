import { clamp, round } from '../utils/num.js';

/**
 * Milk Check: estimates added-water percentage from field readings.
 *
 * Physics-based, transparent model (no black box):
 *  1. Temperature-correct the lactometer reading (CLR) to the standard temperature.
 *  2. Lactometer method: water% = (normal_clr - corrected) / normal_clr * 100.
 *     If the admin has fitted a calibration (>= 8 labelled samples), use the fitted line instead.
 *  3. If fat% is known, use the Richmond formula SNF = CLR/4 + 0.2*fat + 0.14, which removes the
 *     fat confounder, and compare to normal SNF. SNF method is weighted higher when available.
 *  4. Conductivity (optional) corroborates: dilution lowers conductivity.
 *  5. Image brightness (optional, from the phone camera) is stored as supporting evidence and only
 *     raises a flag; it never changes the percentage.
 *
 * This is a screening estimate, not a laboratory result. Confidence and an error range are returned
 * so that callers never present it as exact.
 */
export function estimateWater(input, s) {
  const { lactometer, temperature, fat, conductivity, imageBrightness } = input;
  const flags = [];

  const corrected = lactometer + s.temp_coeff * (temperature - s.standard_temp_c);

  let clrWater;
  const cal = s.calibration;
  const calibrated = !!(cal && cal.n >= 8 && typeof cal.slope === 'number');
  if (calibrated) clrWater = cal.intercept + cal.slope * corrected;
  else clrWater = ((s.normal_clr - corrected) / s.normal_clr) * 100;
  clrWater = clamp(clrWater, 0, 100);

  let snf = null;
  let estimate = clrWater;
  let method = calibrated ? 'lactometer_calibrated' : 'lactometer';
  let halfWidth = calibrated ? Math.max(cal.rmse * 1.5, 2) : 4;
  let confidence = calibrated ? 0.63 : 0.55;

  if (typeof fat === 'number') {
    snf = corrected / 4 + 0.2 * fat + 0.14;
    const snfWater = clamp(((s.normal_snf - snf) / s.normal_snf) * 100, 0, 100);
    estimate = 0.25 * clrWater + 0.75 * snfWater;
    method = calibrated ? 'lactometer_calibrated+fat_snf' : 'lactometer+fat_snf';
    halfWidth = Math.min(halfWidth, 2.5);
    confidence += 0.2;
    if (fat < 3) flags.push('low_fat');
  } else {
    flags.push('screening_only_no_fat');
  }

  if (typeof conductivity === 'number') {
    const condWater = clamp(((s.normal_conductivity_ms - conductivity) / s.normal_conductivity_ms) * 100, 0, 100);
    const gap = Math.abs(condWater - estimate);
    estimate = 0.8 * estimate + 0.2 * condWater;
    method += '+conductivity';
    if (gap <= 8) {
      confidence += 0.1;
      halfWidth = Math.max(halfWidth - 0.5, 1.5);
    } else {
      confidence -= 0.1;
      flags.push('sensor_disagreement');
    }
  }

  if (typeof imageBrightness === 'number') {
    confidence += 0.02;
    if (imageBrightness < 110) flags.push('image_unusually_dark_or_translucent');
  }

  if (corrected > s.normal_clr + 3) flags.push('reading_above_normal_possible_skimming_or_added_solids');
  if (temperature < 10 || temperature > 35) flags.push('temperature_out_of_reliable_range');
  if (flags.includes('temperature_out_of_reliable_range')) {
    confidence -= 0.1;
    halfWidth += 2;
  }

  estimate = clamp(estimate, 0, 100);
  return {
    corrected_reading: round(corrected, 2),
    estimated_water_percent: round(estimate, 1),
    estimate_low: round(clamp(estimate - halfWidth, 0, 100), 1),
    estimate_high: round(clamp(estimate + halfWidth, 0, 100), 1),
    snf_estimated: snf === null ? null : round(snf, 2),
    confidence: round(clamp(confidence, 0.2, 0.95), 2),
    method,
    flags,
  };
}

export function gradeFor(waterPercent, s) {
  if (waterPercent <= s.grade_a_max_water) return 'A';
  if (waterPercent <= s.grade_b_max_water) return 'B';
  return 'FAIL';
}

/** Quality-based recommended price per litre (ETB). FAIL milk has no marketplace price. */
export function recommendedPrice(grade, fat, s) {
  if (grade === 'FAIL') return null;
  let price = s.base_price_per_litre * (s.grade_multipliers[grade] ?? 0);
  if (typeof fat === 'number' && fat > 3.5) {
    const bonus = Math.min((fat - 3.5) * s.fat_bonus_per_point, s.fat_bonus_cap);
    price *= 1 + bonus;
  }
  return round(price, 2);
}

/** Full assessment used for both producer tests and delivery checks. */
export function assess(input, settings) {
  const est = estimateWater(input, settings);
  const grade = gradeFor(est.estimated_water_percent, settings);
  return { ...est, grade, recommended_price: recommendedPrice(grade, input.fat, settings) };
}

/** Least-squares fit of known water% against corrected lactometer reading. */
export function fitCalibration(samples) {
  const n = samples.length;
  if (n < 8) return { ok: false, reason: 'At least 8 labelled samples are needed to fit a calibration', n };
  const xs = samples.map((s) => s.corrected_reading);
  const ys = samples.map((s) => s.known_water_percent);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return { ok: false, reason: 'Samples must include different lactometer readings', n };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  if (slope >= 0) return { ok: false, reason: 'Samples are inconsistent: water % should fall as the reading rises', n };
  const sse = xs.reduce((acc, x, i) => acc + (ys[i] - (intercept + slope * x)) ** 2, 0);
  const rmse = Math.sqrt(sse / n);
  const ssTot = ys.reduce((acc, y) => acc + (y - my) ** 2, 0);
  return { ok: true, n, slope: round(slope, 4), intercept: round(intercept, 3), rmse: round(rmse, 2), r2: ssTot === 0 ? 1 : round(1 - sse / ssTot, 3) };
}

/**
 * Error diagnostics for a calibration data set: how well the fitted line (and, for comparison, the generic
 * baseline) reproduces the samples whose water content is known, plus warnings about gaps in the data.
 */
export function diagnoseCalibration(samples, s) {
  const fit = fitCalibration(samples);
  const grade = (w) => gradeFor(w, s);
  const baseline = (x) => clamp(((s.normal_clr - x) / s.normal_clr) * 100, 0, 100);
  const n = samples.length;
  const summary = (predict) => {
    const res = samples.map((x) => predict(x.corrected_reading) - x.known_water_percent);
    const mae = res.reduce((a, r) => a + Math.abs(r), 0) / n;
    const rmse = Math.sqrt(res.reduce((a, r) => a + r * r, 0) / n);
    const bias = res.reduce((a, r) => a + r, 0) / n;
    const gradeHits = samples.filter((x) => grade(predict(x.corrected_reading)) === grade(x.known_water_percent)).length;
    return { mae: round(mae, 2), rmse: round(rmse, 2), bias: round(bias, 2), max_abs_error: round(Math.max(...res.map(Math.abs)), 2), grade_agreement_percent: Math.round((gradeHits / n) * 100) };
  };
  const warnings = [];
  const known = samples.map((x) => x.known_water_percent);
  const readings = samples.map((x) => x.corrected_reading);
  if (n < 8) warnings.push(`Only ${n} sample(s): at least 8 are needed to fit, 15+ recommended.`);
  else if (n < 15) warnings.push('Fewer than 15 samples: the fitted line may not be stable. Add more across different cows and days.');
  if (n && Math.min(...known) > 2) warnings.push('No (near) undiluted sample. Add a 0% water sample to anchor the line.');
  if (n && Math.max(...known) < 20) warnings.push('No sample above 20% water. The failing range is not validated.');
  if (n && Math.max(...readings) - Math.min(...readings) < 3) warnings.push('Lactometer readings cover a narrow range. Add more different dilutions.');

  if (!fit.ok) return { fit, calibrated: null, baseline: n ? summary(baseline) : null, samples: [], warnings };

  const predict = (x) => clamp(fit.intercept + fit.slope * x, 0, 100);
  const calibrated = summary(predict);
  const threshold = Math.max(2 * calibrated.rmse, 3);
  const rows = samples.map((x) => {
    const predicted = round(predict(x.corrected_reading), 1);
    const residual = round(predicted - x.known_water_percent, 1);
    return { id: x.id, corrected_reading: x.corrected_reading, known_water_percent: x.known_water_percent, predicted_water_percent: predicted, residual, outlier: Math.abs(residual) > threshold, grade_match: grade(predicted) === grade(x.known_water_percent) };
  });
  if (rows.some((r) => r.outlier)) warnings.push('Some samples are outliers (large residual). Re-measure them: a mis-read lactometer or a mixing error is likely.');
  if (calibrated.rmse > 3) warnings.push(`Typical error is ${calibrated.rmse} water points; the Grade A/B boundary is only ${s.grade_b_max_water - s.grade_a_max_water} points wide, so grades near the boundaries are unreliable.`);
  if (fit.r2 < 0.9) warnings.push('R² is below 0.9: the readings explain little of the dilution. Check lactometer reading technique and temperature.');
  return { fit, calibrated, baseline: summary(baseline), samples: rows, warnings };
}
