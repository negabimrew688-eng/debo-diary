import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateWater, gradeFor, recommendedPrice, assess, fitCalibration } from '../src/services/milkQuality.service.js';
import { DEFAULT_SETTINGS as S } from '../src/services/settings.service.js';

const input = (o) => ({ lactometer: 29, temperature: 20, ...o });

test('undiluted milk reads about 0% water and grades A', () => {
  const r = assess(input({}), S);
  assert.equal(r.estimated_water_percent, 0);
  assert.equal(r.grade, 'A');
  assert.equal(r.recommended_price, 50);
});

test('20% dilution (reading 23.2) is estimated near 20% and fails', () => {
  const r = assess(input({ lactometer: 23.2 }), S);
  assert.ok(Math.abs(r.estimated_water_percent - 20) < 0.5, `got ${r.estimated_water_percent}`);
  assert.equal(r.grade, 'FAIL');
  assert.equal(r.recommended_price, null);
});

test('temperature correction: 28.4 at 23 C equals 29 at 20 C', () => {
  const r = estimateWater(input({ lactometer: 28.4, temperature: 23 }), S);
  assert.equal(r.corrected_reading, 29);
  assert.equal(r.estimated_water_percent, 0);
});

test('grade thresholds are inclusive at the boundary', () => {
  assert.equal(gradeFor(5, S), 'A');
  assert.equal(gradeFor(5.1, S), 'B');
  assert.equal(gradeFor(15, S), 'B');
  assert.equal(gradeFor(15.1, S), 'FAIL');
});

test('Grade B is priced below A and high fat earns a capped bonus', () => {
  assert.equal(recommendedPrice('B', 3.5, S), 42.5);
  assert.equal(recommendedPrice('A', 4.5, S), 51.5); // +3% of 50
  assert.equal(recommendedPrice('A', 12, S), 55); // capped at +10%
});

test('fat reading narrows the range and raises confidence', () => {
  const without = estimateWater(input({ lactometer: 27 }), S);
  const withFat = estimateWater(input({ lactometer: 27, fat: 3.5 }), S);
  assert.ok(withFat.confidence > without.confidence);
  assert.ok(withFat.estimate_high - withFat.estimate_low < without.estimate_high - without.estimate_low);
  assert.ok(without.flags.includes('screening_only_no_fat'));
});

test('conductivity that disagrees lowers confidence and raises a flag', () => {
  const agree = estimateWater(input({ fat: 3.8, conductivity: 4.5 }), S);
  const disagree = estimateWater(input({ fat: 3.8, conductivity: 3.0 }), S);
  assert.ok(disagree.confidence < agree.confidence);
  assert.ok(disagree.flags.includes('sensor_disagreement'));
});

test('very high reading is flagged as possible skimming or added solids', () => {
  assert.ok(estimateWater(input({ lactometer: 34 }), S).flags.some((f) => f.startsWith('reading_above_normal')));
});

test('calibration fit recovers a known line and is used once active', () => {
  const samples = [];
  for (let x = 21; x <= 29; x += 1) samples.push({ corrected_reading: x, known_water_percent: Math.max(0, ((29 - x) / 29) * 100 + 2) });
  const fit = fitCalibration(samples);
  assert.equal(fit.ok, true);
  assert.ok(fit.slope < 0);
  assert.ok(fit.r2 > 0.99);
  const calibrated = estimateWater(input({ lactometer: 29 }), { ...S, calibration: { slope: fit.slope, intercept: fit.intercept, n: fit.n, rmse: fit.rmse } });
  assert.ok(calibrated.method.startsWith('lactometer_calibrated'));
  assert.ok(calibrated.estimated_water_percent >= 1, 'fitted offset (+2%) should show up');
});

test('calibration rejects too few or inconsistent samples', () => {
  assert.equal(fitCalibration([{ corrected_reading: 29, known_water_percent: 0 }]).ok, false);
  const rising = Array.from({ length: 8 }, (_, i) => ({ corrected_reading: 20 + i, known_water_percent: i * 3 }));
  assert.equal(fitCalibration(rising).ok, false);
});
