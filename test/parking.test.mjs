import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeOsmParking, parseOsmRate, parkingKind, isUseful, overpassQuery } from '../scripts/lib/osmparking.mjs';
import { parseOpeningHours, openStatus, rateLabel, estimateCost, hasPrice, mergeRates, filterVenues, floodNote } from '../public/js/parking.js';

// พฤหัสบดี 22 ต.ค. 2569 เวลาไทย
const bkk = (h, m = 0, day = 22) => Date.UTC(2026, 9, day, h - 7, m);

test('parseOsmRate reads fee / charge / charge:conditional', () => {
  assert.deepEqual(parseOsmRate({ fee: 'no' }), { free: true });
  assert.deepEqual(parseOsmRate({ fee: 'yes' }), { paid: true });
  assert.equal(parseOsmRate({}), null);
  assert.deepEqual(parseOsmRate({ fee: 'yes', charge: '20 THB/hour' }), { perHour: 20 });
  assert.deepEqual(parseOsmRate({ charge: '30 บาท/ชม.' }), { perHour: 30 });
  assert.deepEqual(parseOsmRate({ charge: '100 THB/day' }), { perDay: 100 });
  assert.match(parseOsmRate({ charge: '30 THB' }).note, /ไม่ระบุ/);
  assert.deepEqual(parseOsmRate({ fee: 'yes', charge: '30 THB/hour', 'charge:conditional': 'no @ (customers AND stay < 2 hours)' }), {
    perHour: 30,
    freeHours: 2,
    freeFor: 'customers',
  });
});

test('isUseful / parkingKind keep public, identifiable parking', () => {
  assert.equal(isUseful({ amenity: 'parking' }), false); // ลานไม่มีชื่อ ไม่มีข้อมูล
  assert.equal(isUseful({ amenity: 'parking', name: 'X', access: 'private' }), false);
  assert.equal(isUseful({ amenity: 'parking', parking: 'street_side', name: 'X' }), false);
  assert.equal(isUseful({ amenity: 'parking', parking: 'multi-storey' }), true);
  assert.equal(isUseful({ amenity: 'parking', capacity: '50' }), true);
  assert.equal(isUseful({ shop: 'mall' }), false);
  assert.equal(parkingKind({ shop: 'mall' }), 'mall');
  assert.equal(parkingKind({ amenity: 'parking', park_ride: 'bus' }), 'park_ride');
  assert.equal(parkingKind({ amenity: 'parking', parking: 'underground' }), 'underground');
  assert.equal(parkingKind({ amenity: 'parking', building: 'yes' }), 'building');
  assert.match(overpassQuery(), /amenity"="parking/);
});

test('normalizeOsmParking builds venues from Overpass elements', () => {
  const v = normalizeOsmParking([
    { type: 'way', id: 1, center: { lat: 13.7465211, lon: 100.539 }, tags: { amenity: 'parking', parking: 'multi-storey', name: 'Car Park', capacity: '1,200', 'building:levels': '6' } },
    { type: 'node', id: 2, lat: 13.7, lon: 100.5, tags: { shop: 'mall', name: 'ห้างทดสอบ', 'name:en': 'Test Mall', fee: 'no', opening_hours: '10:00-22:00' } },
    { type: 'node', id: 3, lat: 13.7, lon: 100.5, tags: { amenity: 'parking' } },
    { type: 'node', id: 4, tags: { amenity: 'parking', name: 'ไม่มีพิกัด' } },
  ]);
  assert.equal(v.length, 2);
  const park = v.find((x) => x.id === 'way/1');
  assert.deepEqual([park.kind, park.capacity, park.levels, park.lat], ['building', 1200, 6, 13.746521]);
  const mall = v.find((x) => x.id === 'node/2');
  assert.equal(mall.kind, 'mall');
  assert.equal(mall.nameEn, 'Test Mall');
  assert.equal(mall.rate, undefined); // fee ของห้างไม่ใช่ค่าจอด
  assert.equal(mall.hours, '10:00-22:00');
});

test('parking_osm.json is valid and inside Bangkok area', () => {
  const data = JSON.parse(readFileSync(new URL('../public/data/parking_osm.json', import.meta.url), 'utf8'));
  assert.match(data.license, /OpenStreetMap/);
  assert.ok(data.venues.length >= 100);
  for (const v of data.venues) {
    assert.ok(v.id && v.name && v.kind, JSON.stringify(v));
    assert.ok(v.lat > 13.4 && v.lat < 14.2 && v.lon > 100.2 && v.lon < 101, v.id);
  }
});

test('parking_rates.json entries match OSM ids or have coordinates', () => {
  const osm = JSON.parse(readFileSync(new URL('../public/data/parking_osm.json', import.meta.url), 'utf8'));
  const rates = JSON.parse(readFileSync(new URL('../public/data/parking_rates.json', import.meta.url), 'utf8'));
  const ids = new Set(osm.venues.map((v) => v.id));
  for (const r of rates.venues) {
    assert.ok(r.osm ? ids.has(r.osm) : Number.isFinite(r.lat) && Number.isFinite(r.lon), `${r.name}: osm id ไม่พบ หรือไม่มีพิกัด`);
    assert.ok(r.source?.url, `${r.name}: ต้องระบุแหล่งที่มา`);
  }
});

test('parseOpeningHours handles common Bangkok formats', () => {
  assert.deepEqual(parseOpeningHours('24/7'), { always: true });
  assert.deepEqual(parseOpeningHours('Mo-Su 00:00-24:00'), { always: true });
  assert.deepEqual(parseOpeningHours('10:00-22:00').days[3], [[600, 1320]]);
  assert.deepEqual(parseOpeningHours('10.00 - 22.00').days[0], [[600, 1320]]);
  assert.deepEqual(parseOpeningHours('10:00-22:00 hrs.').days[6], [[600, 1320]]);
  const wk = parseOpeningHours('Mo-Fr 10:30-21:00; PH,Sa,Su 10:00-22:00');
  assert.deepEqual([wk.days[1], wk.days[6], wk.days[0]], [[[630, 1260]], [[600, 1320]], [[600, 1320]]]);
  const comma = parseOpeningHours('Mo-Fr 10:00-21:00, Sa,Su 09:00-21:00');
  assert.deepEqual([comma.days[5], comma.days[6]], [[[600, 1260]], [[540, 1260]]]);
  assert.deepEqual(parseOpeningHours('Mo-Su 10:00-02:00').days[2], [[600, 1560]]); // ข้ามเที่ยงคืน
  assert.equal(parseOpeningHours('Mo-Fr 09:00-20:00').days[0], undefined); // เสาร์-อาทิตย์ปิด
  assert.equal(parseOpeningHours('Mo-Su 08:00-20:30; PH open').days[4][0][1], 1230);
  assert.equal(parseOpeningHours('sunrise-sunset'), null);
  assert.equal(parseOpeningHours(''), null);
});

test('openStatus uses Bangkok time, soon-to-close and past midnight', () => {
  assert.deepEqual(openStatus('10:00-22:00', bkk(15)), { state: 'open', label: 'เปิด · ปิด 22:00' });
  assert.equal(openStatus('10:00-22:00', bkk(21, 30)).state, 'soon');
  assert.deepEqual(openStatus('10:00-22:00', bkk(8)), { state: 'closed', label: 'ปิด · เปิด 10:00' });
  assert.equal(openStatus('10:00-22:00', bkk(23)).label, 'ปิดแล้ววันนี้');
  // เปิดถึงตี 2 ของวันพุธ → ตี 1 วันพฤหัสยังเปิด
  assert.deepEqual(openStatus('Mo-Su 10:00-02:00', bkk(1)), { state: 'soon', label: 'กำลังจะปิด · ปิด 02:00' });
  assert.equal(openStatus('Mo-Fr 09:00-20:00', bkk(12, 0, 24)).state, 'closed'); // เสาร์
  assert.equal(openStatus('24/7', bkk(3)).label, 'เปิด 24 ชม.');
  assert.equal(openStatus(undefined).state, 'unknown');
});

test('rateLabel / estimateCost follow the rate model', () => {
  const freeThen = { freeHours: 2, perHour: 20 };
  assert.equal(rateLabel(freeThen), 'จอดฟรี 2 ชม. · ชม. ถัดไป 20 บาท');
  assert.deepEqual([1, 2, 3, 4.5].map((h) => estimateCost(freeThen, h)), [0, 0, 20, 60]);

  const block = { firstHours: 2, firstThb: 30, perHour: 20 };
  assert.equal(rateLabel(block), '2 ชม. แรก 30 บาท · ชม. ถัดไป 20 บาท');
  assert.deepEqual([1, 2, 4].map((h) => estimateCost(block, h)), [30, 30, 70]);

  const capped = { perHour: 20, capDay: 240 };
  assert.equal(rateLabel(capped), 'ชม. ละ 20 บาท · สูงสุด 240 บาท/วัน');
  assert.equal(estimateCost(capped, 3), 60);
  assert.equal(estimateCost(capped, 20), 240);

  assert.equal(rateLabel({ free: true }), 'จอดฟรี');
  assert.equal(estimateCost({ free: true }, 5), 0);
  assert.equal(estimateCost({ flat: 50 }, 5), 50);
  assert.equal(estimateCost({ perDay: 100 }, 30), 200);
  assert.equal(rateLabel({ paid: true }), 'เสียค่าจอด (ยังไม่มีข้อมูลราคา)');
  assert.equal(estimateCost({ paid: true }, 2), null);
  assert.equal(estimateCost({ freeHours: 1 }, 3), null); // ไม่รู้ราคาหลังชั่วโมงฟรี
  assert.equal(rateLabel(null), 'ไม่มีข้อมูลค่าจอด');
  assert.equal(hasPrice({ paid: true }), false);
  assert.equal(hasPrice({ freeHours: 1 }), true);
});

test('mergeRates applies verified rates and adds new venues', () => {
  const osm = [{ id: 'way/1', name: 'A', kind: 'mall', lat: 13.7, lon: 100.5 }];
  const merged = mergeRates(osm, {
    venues: [
      { osm: 'way/1', rate: { freeHours: 2, perHour: 20 }, hours: '24/7', source: { title: 'เว็บห้าง', url: 'https://example.com' }, checkedAt: '2026-10-22' },
      { name: 'ลานใหม่', lat: 13.8, lon: 100.6, rate: { perHour: 30 }, source: { url: 'https://example.org' } },
      { osm: 'way/999', rate: { free: true } }, // ไม่พบใน OSM และไม่มีพิกัด → ข้าม
    ],
  });
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].rate, { freeHours: 2, perHour: 20 });
  assert.equal(merged[0].verified.checkedAt, '2026-10-22');
  assert.equal(osm[0].rate, undefined); // ไม่แก้ข้อมูลต้นฉบับ
  assert.equal(merged[1].name, 'ลานใหม่');
});

test('filterVenues / floodNote', () => {
  const list = [
    { name: 'ห้าง A', kind: 'mall', hours: '24/7', rate: { freeHours: 2, perHour: 20 } },
    { name: 'อาคารจอด B', kind: 'building', levels: 5, rate: { paid: true } },
    { name: 'ใต้ดิน C', kind: 'underground', rate: { free: true } },
  ];
  assert.deepEqual(filterVenues(list, { filter: 'free' }).map((v) => v.name), ['ห้าง A', 'ใต้ดิน C']);
  assert.deepEqual(filterVenues(list, { filter: 'priced' }).map((v) => v.name), ['ห้าง A', 'ใต้ดิน C']);
  assert.deepEqual(filterVenues(list, { filter: 'open' }).map((v) => v.name), ['ห้าง A']);
  assert.deepEqual(filterVenues(list, { filter: 'building' }).map((v) => v.name), ['อาคารจอด B']);
  assert.deepEqual(filterVenues(list, { q: 'อาคาร จอด' }).map((v) => v.name), ['อาคารจอด B']);
  assert.equal(floodNote(list[2]).level, 'warn');
  assert.match(floodNote(list[1]).text, /5 ชั้น/);
  assert.equal(floodNote(list[0]), null);
});
