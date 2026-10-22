#!/usr/bin/env node
// ดึงที่จอดรถ/ห้างในกรุงเทพฯ-ปริมณฑลจาก OpenStreetMap (Overpass API)
// → public/data/parking_osm.json (รันสัปดาห์ละครั้งใน GitHub Actions — ข้อมูล OSM เปลี่ยนช้า ไม่ต้องยิงถี่)
// ค่าจอดที่ผู้ดูแลตรวจสอบเองอยู่ใน public/data/parking_rates.json (ไม่ถูกเขียนทับโดยสคริปต์นี้)
// รันเอง: npm run update-parking
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { OVERPASS_URLS, PARKING_BBOX, overpassQuery, normalizeOsmParking } from './lib/osmparking.mjs';

const OUT = fileURLToPath(new URL('../public/data/parking_osm.json', import.meta.url));
const UA = 'BangkokFloodWatch/1.0 (+https://github.com/pee4455/floodw)'; // Overpass ตอบ 406 กับ UA แบบเบราว์เซอร์
const MIN_VENUES = 100; // ได้น้อยกว่านี้ = Overpass ตอบไม่ครบ ไม่เขียนทับไฟล์เดิม

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Overpass มักตอบ 429/502/504 ช่วงคนใช้เยอะ — ลองแต่ละเซิร์ฟเวอร์ 2 รอบ เว้นระยะก่อนลองใหม่ */
async function overpass(query) {
  let lastErr;
  for (const url of [...OVERPASS_URLS, ...OVERPASS_URLS]) {
    if (lastErr) await sleep(30000);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 180000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark);
      return json.elements || [];
    } catch (e) {
      lastErr = new Error(`${url}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
      console.warn(lastErr.message);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

const elements = await overpass(overpassQuery(PARKING_BBOX));
const venues = normalizeOsmParking(elements);
if (venues.length < MIN_VENUES) {
  console.error(`ได้ที่จอดเพียง ${venues.length} แห่ง (จาก ${elements.length} element) — ไม่เขียนทับไฟล์เดิม`);
  process.exit(1);
}
const count = (k) => venues.filter((v) => v.kind === k).length;
// ที่จอด 1 แห่งต่อบรรทัด: ไฟล์เล็ก และ git diff บอกได้ว่าแห่งไหนเปลี่ยน (workflow ใช้ตัดสินว่าต้อง commit ไหม)
const head = {
  generatedAt: new Date().toISOString(),
  source: 'OpenStreetMap (Overpass API)',
  license: '© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright',
  bbox: PARKING_BBOX,
};
const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
await writeFile(OUT, `{\n${lines.join('\n')}\n  "venues": [\n${venues.map((v) => `    ${JSON.stringify(v)}`).join(',\n')}\n  ]\n}\n`);
console.log(
  `บันทึก ${venues.length} แห่ง (ห้าง ${count('mall')}, อาคารจอด ${count('building')}, ใต้ดิน ${count('underground')}, ` +
    `จอดแล้วจร ${count('park_ride')}, ลานจอด ${count('surface')}, มีข้อมูลค่าจอด ${venues.filter((v) => v.rate).length}) → ${OUT}`,
);
