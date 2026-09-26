import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFeatures, js100Kinds, filterJs100, filterRoads, googleTrafficUrl, MODES, LAYER_KEYS } from '../public/js/mapfeatures.js';

const floodRoads = JSON.parse(readFileSync(new URL('../public/data/flood_roads.json', import.meta.url), 'utf8'));

test('flood_roads.json roads are drawable', () => {
  assert.ok(floodRoads.roads.length >= 10);
  for (const r of floodRoads.roads) {
    assert.ok(['avoid', 'caution'].includes(r.level), r.name);
    assert.ok(r.path.length >= 2, r.name);
    for (const [lat, lon] of r.path) assert.ok(lat > 13.4 && lat < 14.2 && lon > 100.2 && lon < 101, r.name);
  }
});

test('buildFeatures makes road lines and grouped JS100 pins', () => {
  const js100 = {
    traffic: [
      { text: 'น้ำท่วมขัง ถนนเทพรัตน', categories: ['flood'], places: [{ name: 'บางนา', lat: 13.67, lon: 100.6 }] },
      { text: 'อุบัติเหตุ รถชนกัน ย่านบางนา', categories: [], places: [{ name: 'บางนา', lat: 13.67, lon: 100.6 }] },
    ],
  };
  const f = buildFeatures({ curated: null, news: null, floodRoads, js100 });
  const lines = f.filter((x) => x.layer === 'roads');
  assert.equal(lines.length, floodRoads.roads.length);
  assert.ok(lines.every((l) => l.type === 'line' && l.id.startsWith('road:')));
  assert.match(lines[0].popup(), /Google Maps/);
  const pins = f.filter((x) => x.layer === 'js100');
  assert.equal(pins.length, 1);
  assert.match(pins[0].html, /js100-pin flood/);
  assert.match(pins[0].popup(), /2 รายการ/);
});

test('js100Kinds / filterJs100', () => {
  assert.deepEqual(js100Kinds({ text: 'อุบัติเหตุ รถชนกัน การจราจรติดขัด' }), ['accident', 'jam']);
  assert.deepEqual(js100Kinds({ text: 'ฝนตก', categories: ['flood'] }), ['flood']);
  const items = [{ text: 'น้ำท่วมขัง ถนนเทพรัตน' }, { text: 'รถเสีย พระราม 2', places: [{ name: 'ถ.พระราม 2' }] }];
  assert.equal(filterJs100(items, { kind: 'flood' }).length, 1);
  assert.equal(filterJs100(items, { q: 'พระราม2' }).length, 1);
});

test('filterRoads sorts avoid first and filters by zone/query', () => {
  const all = filterRoads(floodRoads.roads);
  const firstCaution = all.findIndex((r) => r.level === 'caution');
  assert.ok(all.slice(firstCaution).every((r) => r.level === 'caution'));
  assert.ok(filterRoads(floodRoads.roads, { q: 'วิภาวดี' }).every((r) => /วิภาวดี/.test(r.name + r.section)));
  assert.ok(filterRoads(floodRoads.roads, { zone: 'ธนบุรี' }).every((r) => r.zone === 'ธนบุรี'));
});

test('modes cover every layer and traffic link uses Google traffic layer', () => {
  for (const m of Object.values(MODES)) assert.deepEqual(Object.keys(m.layers).sort(), [...LAYER_KEYS].sort());
  assert.equal(googleTrafficUrl(13.75, 100.5, 13), 'https://www.google.com/maps/@13.75,100.5,13z/data=!5m1!1e1');
});
