#!/usr/bin/env node
// ดึงรายชื่อกล้องจราจรกรุงเทพฯ จากฟีด iTIC/Longdo แล้วตรวจว่าแต่ละกล้องส่งภาพได้จริง
// → public/data/itic_cameras.json (รันทุก 30 นาทีใน GitHub Actions)
// รันเอง: npm run update-cams
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ITIC_FEED_URL, normalizeItic, looksLikeImage } from './lib/itic.mjs';

const OUT = fileURLToPath(new URL('../public/data/itic_cameras.json', import.meta.url));
const UA = 'Mozilla/5.0 (compatible; BangkokFloodWatch/1.0; +https://github.com/pee4455/floodw)';

async function get(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, referer: 'https://pee4455.github.io/floodw/' } });
  } finally {
    clearTimeout(t);
  }
}

async function checkImage(cam) {
  try {
    const res = await get(cam.img, 12000);
    const buf = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    return { ok: res.ok && looksLikeImage(res.headers.get('content-type'), buf.byteLength), status: res.status, bytes: buf.byteLength };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.name === 'AbortError' ? 'timeout' : e.message) };
  }
}

/** ตรวจแบบจำกัดจำนวนพร้อมกัน ไม่ให้ยิงเซิร์ฟเวอร์กล้องหนักเกินไป */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function main() {
  const res = await get(ITIC_FEED_URL, 30000);
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const cams = normalizeItic(await res.json());
  if (cams.length === 0) throw new Error('ฟีดไม่มีกล้องในกรุงเทพฯ — ไม่เขียนทับไฟล์เดิม');

  const checks = await mapLimit(cams, 6, checkImage);
  const now = new Date().toISOString();
  cams.forEach((c, k) => {
    c.ok = checks[k].ok;
    c.checkedAt = now;
  });
  const okCount = cams.filter((c) => c.ok).length;
  if (okCount === 0) {
    // เซิร์ฟเวอร์กล้องล่มทั้งหมด/ถูกบล็อก — เก็บผลตรวจรอบก่อนไว้ดีกว่าบอกว่าเสียทั้งหมด
    let prevOk = 0;
    try {
      prevOk = JSON.parse(await readFile(OUT, 'utf8')).cameras.filter((c) => c.ok).length;
    } catch {
      /* ไม่มีไฟล์เดิม */
    }
    if (prevOk > 0) {
      console.error('ตรวจภาพไม่ผ่านเลยสักกล้อง — ไม่เขียนทับไฟล์เดิม', checks.slice(0, 5));
      process.exitCode = 1;
      return;
    }
  }
  const byOrg = {};
  for (const c of cams) byOrg[c.org || 'อื่น ๆ'] = (byOrg[c.org || 'อื่น ๆ'] || 0) + 1;
  await writeFile(
    OUT,
    `${JSON.stringify({ generatedAt: now, source: 'iTIC Foundation / Longdo Traffic', feed: ITIC_FEED_URL, total: cams.length, ok: okCount, cameras: cams }, null, 1)}\n`,
  );
  console.log(`กล้องกรุงเทพฯ ${cams.length} ตัว ภาพใช้ได้ ${okCount} ตัว`, byOrg);
  const bad = cams.map((c, k) => ({ c, r: checks[k] })).filter((x) => !x.r.ok).slice(0, 5);
  if (bad.length) console.log('ตัวอย่างที่ใช้ไม่ได้:', bad.map((x) => `${x.c.id} ${x.r.status} ${x.r.bytes ?? ''} ${x.r.error ?? ''}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
