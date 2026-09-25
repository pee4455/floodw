import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weightedMean,
  weightedMedian,
  percentile,
  blendSeries,
  dailyTotals,
  sumWindow,
  exceedanceProbability,
  hourlyEnsembleStats,
  ensembleWindowPercentile,
  extractMembers,
  classifyRain,
} from '../public/js/forecast.js';
import { TMD_RAIN_CLASSES } from '../public/js/config.js';

test('weightedMean skips nulls', () => {
  assert.equal(weightedMean([1, null, 3], [1, 5, 1]), 2);
  assert.equal(weightedMean([null], [1]), null);
});

test('weightedMedian resists a single outlier model', () => {
  // ECMWF หนัก 0.5 → ค่ากลางควรตามกลุ่มใหญ่ ไม่ใช่ค่าเฉลี่ยที่ถูกดึงโดย outlier
  assert.equal(weightedMedian([2, 3, 80], [0.4, 0.4, 0.2]), 3);
  assert.equal(weightedMedian([1, 2], [1, 1]), 1.5);
  assert.equal(weightedMedian([5, null], [1, 1]), 5);
  assert.equal(weightedMedian([], []), null);
});

test('percentile interpolates', () => {
  assert.equal(percentile([0, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 90), 4.6);
  assert.equal(percentile([], 90), null);
});

test('blendSeries aligns different time axes', () => {
  const r = blendSeries([
    { weight: 1, time: [0, 1, 2], values: [0, 2, 4] },
    { weight: 1, time: [1, 2, 3], values: [4, 6, 8] },
  ]);
  assert.deepEqual(r.time, [0, 1, 2, 3]);
  assert.deepEqual(r.min, [0, 2, 4, 8]);
  assert.deepEqual(r.max, [0, 4, 6, 8]);
  assert.deepEqual(r.agree, [1, 2, 2, 1]);
  assert.deepEqual(r.consensus, [0, 3, 5, 8]);
});

test('dailyTotals groups by Bangkok local day', () => {
  // 2026-09-25T16:00Z = 23:00 น. วันที่ 25, 17:00Z = 00:00 น. วันที่ 26
  const t1 = Date.parse('2026-09-25T16:00:00Z') / 1000;
  const t2 = Date.parse('2026-09-25T17:00:00Z') / 1000;
  const r = dailyTotals([t1, t2], [1, 2]);
  assert.deepEqual(r.map((d) => [d.day, d.total]), [['2026-09-25', 1], ['2026-09-26', 2]]);
});

test('sumWindow is [from, to)', () => {
  assert.equal(sumWindow([0, 1, 2, 3], [1, 1, 1, null], 1, 3), 2);
});

const sys = (members) => ({ time: [0, 1, 2], members });

test('exceedanceProbability weights systems equally, not by member count', () => {
  const a = sys([[10, 10, 20], [0, 0, 0]]); // 1/2 ≥ 35
  const b = sys([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]); // 0/4
  assert.equal(exceedanceProbability([a, b], 0, 3, 35), 0.25);
  assert.equal(exceedanceProbability([], 0, 3, 35), null);
});

test('hourlyEnsembleStats probability and p90', () => {
  const r = hourlyEnsembleStats([sys([[0, 1, 5], [0, 0, 5]])], 0.5);
  assert.deepEqual(r.prob, [0, 0.5, 1]);
  assert.equal(r.p90[2], 5);
});

test('ensembleWindowPercentile of totals', () => {
  const s = sys([[1, 1, 1], [10, 10, 10]]);
  assert.equal(ensembleWindowPercentile([s], 0, 3, 100), 30);
  assert.equal(ensembleWindowPercentile([s], 0, 3, 0), 3);
});

test('extractMembers picks control + members only', () => {
  const m = extractMembers({ time: [], precipitation: [1], precipitation_member01: [2], temperature_2m: [3] });
  assert.deepEqual(m, [[1], [2]]);
});

test('classifyRain follows TMD thresholds', () => {
  assert.equal(classifyRain(0, TMD_RAIN_CLASSES), null);
  assert.equal(classifyRain(5, TMD_RAIN_CLASSES).label, 'ฝนเล็กน้อย');
  assert.equal(classifyRain(35.1, TMD_RAIN_CLASSES).label, 'ฝนหนัก');
  assert.equal(classifyRain(120, TMD_RAIN_CLASSES).label, 'ฝนหนักมาก');
});
