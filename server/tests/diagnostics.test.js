import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseCalibration } from '../src/services/milkQuality.service.js';
import { DEFAULT_SETTINGS as S } from '../src/services/settings.service.js';
import { api, bearer, resetDb, closeDb, makeUser } from './helpers.js';

// water% = (29 - x) / 29 * 100, with optional noise
const sample = (x, noise = 0) => ({ corrected_reading: x, known_water_percent: Math.max(0, ((29 - x) / 29) * 100 + noise) });

test('clean data: tiny error, calibrated beats generic baseline when the baseline is off', () => {
  const samples = [29, 28, 27, 26, 25, 24, 23, 22, 21, 20].map((x) => ({ ...sample(x, 3) })); // true milk reads 3 points more water than the textbook baseline
  const d = diagnoseCalibration(samples, S);
  assert.equal(d.fit.ok, true);
  assert.ok(d.calibrated.rmse < d.baseline.rmse, `calibrated ${d.calibrated.rmse} should beat baseline ${d.baseline.rmse}`);
  assert.ok(d.baseline.bias < -2, 'baseline under-estimates water by about 3 points');
  assert.equal(d.samples.length, 10);
  assert.ok(d.samples.every((r) => !r.outlier));
});

test('a mis-read sample is flagged as an outlier with a warning', () => {
  const samples = [29, 28, 27, 26, 25, 24, 23, 22, 21, 20].map((x) => sample(x));
  samples[4] = { ...samples[4], known_water_percent: samples[4].known_water_percent + 25 }; // wrong label
  const d = diagnoseCalibration(samples, S);
  assert.ok(d.samples.some((r) => r.outlier));
  assert.ok(d.warnings.some((w) => /outlier/i.test(w)));
});

test('coverage warnings: no undiluted sample, no high-dilution sample, too few samples', () => {
  const narrow = [27.5, 27.3, 27.1, 26.9, 26.7, 26.5, 26.3, 26.1].map((x) => sample(x));
  const d = diagnoseCalibration(narrow, S);
  assert.ok(d.warnings.some((w) => /undiluted/i.test(w)));
  assert.ok(d.warnings.some((w) => /above 20%/i.test(w)));
  assert.ok(d.warnings.some((w) => /narrow range/i.test(w)));
  const few = diagnoseCalibration([sample(29), sample(25)], S);
  assert.equal(few.fit.ok, false);
  assert.ok(few.warnings.some((w) => /Only 2 sample/.test(w)));
});

test('noisy data warns that grade boundaries are unreliable', () => {
  const noise = [6, -6, 5, -5, 7, -7, 4, -4, 6, -6];
  const samples = [29, 28, 27, 26, 25, 24, 23, 22, 21, 20].map((x, i) => sample(x, noise[i]));
  const d = diagnoseCalibration(samples, S);
  assert.ok(d.warnings.some((w) => /boundar/i.test(w)), JSON.stringify(d.warnings));
});

let admin;
before(async () => { await resetDb(); admin = await makeUser('admin'); });
after(closeDb);

test('API: diagnostics and what-if preview', async () => {
  for (let i = 0; i < 9; i++) {
    await api().post('/api/v1/admin/calibration').set(bearer(admin)).send({ lactometer_reading: 29 - i * 1.1, temperature_c: 20, known_water_percent: Math.round((i * 1.1 / 29) * 1000) / 10 });
  }
  const r = await api().get('/api/v1/admin/calibration').set(bearer(admin));
  assert.equal(r.status, 200);
  assert.equal(r.body.diagnostics.per_sample.length, 9);
  assert.ok(r.body.diagnostics.calibrated.rmse < 1);
  assert.ok(Array.isArray(r.body.diagnostics.warnings));

  const p = await api().post('/api/v1/admin/calibration/preview').set(bearer(admin)).send({ lactometer_reading: 26, temperature_c: 20, fat_percent: 3.5 });
  assert.equal(p.status, 200);
  assert.ok(p.body.current_model.estimated_water_percent >= 0 && p.body.generic_baseline.grade);
  assert.equal((await api().post('/api/v1/admin/calibration/preview').set(bearer(admin)).send({ lactometer_reading: 99, temperature_c: 20 })).status, 400);
  const farmer = await makeUser('farmer');
  assert.equal((await api().post('/api/v1/admin/calibration/preview').set(bearer(farmer)).send({ lactometer_reading: 26, temperature_c: 20 })).status, 403);
});
