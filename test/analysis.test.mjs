import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, agreementLevel } from '../public/js/analysis.js';
import { FORECAST_MODELS } from '../public/js/config.js';
import { makeForecast, makeEnsemble, makeTide } from './fixtures.mjs';

const now = Date.parse('2026-09-25T05:30:00Z') / 1000; // 12:30 น.

test('analyze produces consistent summary from several models', () => {
  const models = FORECAST_MODELS.map((model, i) => ({ model, data: makeForecast(now, 3 + i) }));
  const ensembles = [{ model: { id: 'e1' }, ...(({ hourly }) => ({ time: hourly.time, members: Object.keys(hourly).filter((k) => k !== 'time').map((k) => hourly[k]) }))(makeEnsemble(now, 20)) }];
  const tide = (({ hourly }) => ({ time: hourly.time, level: hourly.sea_level_height_msl }))(makeTide(now));
  const r = analyze({ models, ensembles, tide, riverAlert: 2, now });

  assert.equal(r.models.length, 6);
  assert.ok(r.rain24 > 0);
  // ค่ากลาง 24 ชม. อยู่ระหว่างโมเดลต่ำสุด–สูงสุด
  assert.ok(r.rain24 >= Math.min(...r.rain24Models) && r.rain24 <= Math.max(...r.rain24Models));
  assert.ok(r.rain24P90 > 0);
  assert.ok(r.probHeavy24 >= 0 && r.probHeavy24 <= 1);
  assert.ok(r.tideMax > 0.5 && r.tideMax <= 0.8);
  assert.equal(r.chart.time.length, 72);
  assert.equal(r.nextHours.length, 6);
  assert.equal(r.daily.length, 7);
  assert.equal(r.daily[0].day, '2026-09-25');
  assert.ok(r.daily.every((d) => d.totals.length === 6));
  assert.ok(r.risk.score >= 0 && r.risk.score <= 100);
  assert.equal(r.risk.coverage, 1);
});

test('analyze tolerates failed models and no ensemble', () => {
  const models = FORECAST_MODELS.map((model, i) => ({ model, data: i < 2 ? makeForecast(now, 4) : null }));
  const r = analyze({ models, ensembles: [], tide: { time: [], level: [] }, now });
  assert.equal(r.models.length, 2);
  assert.equal(r.probHeavy24, null);
  assert.ok(r.maxHourlyP90 > 0, 'falls back to model max');
  assert.ok(r.risk.score != null);
});

test('agreementLevel', () => {
  assert.equal(agreementLevel([10, 11, 12], 11).key, 'high');
  assert.equal(agreementLevel([0, 60], 20).key, 'low');
  assert.equal(agreementLevel([5], 5), null);
});
