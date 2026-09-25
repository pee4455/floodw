import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFloodRisk } from '../public/js/risk.js';

test('dry day → low risk', () => {
  const r = computeFloodRisk({ rain24Consensus: 0, rain24P90: 1, probHeavy24: 0, maxHourlyP90: 0.5, rainPast72: 0, tideMax: 0.2, riverAlert: 0 });
  assert.ok(r.score < 10, `score ${r.score}`);
  assert.equal(r.level.key, 'low');
});

test('very heavy rain + saturated + high tide + river alert → severe', () => {
  const r = computeFloodRisk({ rain24Consensus: 80, rain24P90: 130, probHeavy24: 0.9, maxHourlyP90: 40, rainPast72: 150, tideMax: 1.3, riverAlert: 3 });
  assert.ok(r.score >= 90, `score ${r.score}`);
  assert.equal(r.level.key, 'severe');
});

test('missing factors are rescaled, not counted as zero', () => {
  const full = computeFloodRisk({ rain24P90: 90, probHeavy24: 1, maxHourlyP90: 30, rainPast72: 120, tideMax: 1.2, riverAlert: 3 });
  const noEns = computeFloodRisk({ rain24Consensus: 90, rain24P90: null, probHeavy24: null, maxHourlyP90: 30, rainPast72: 120, tideMax: null, riverAlert: 3 });
  assert.equal(full.score, 100);
  assert.equal(noEns.score, 100);
  assert.ok(noEns.coverage < 1);
});

test('factor maxima sum to 100', () => {
  const r = computeFloodRisk({ riverAlert: 0 });
  assert.equal(r.factors.reduce((s, f) => s + f.max, 0), 100);
});
