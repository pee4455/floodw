#!/usr/bin/env node
// ดึงรายชื่อกล้องจราจรกรุงเทพฯ จากฟีด iTIC/Longdo แล้วตรวจว่าแต่ละกล้องส่งภาพได้จริง
// → public/data/itic_cameras.json (รันทุก 30 นาทีใน GitHub Actions)
// รันเอง: npm run update-cams
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ITIC_FEED_URL, normalizeItic, looksLikeImage, parsePlaylist } from './lib/itic.mjs';

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

/**
 * ตรวจว่ากล้องใช้ได้จริง: เพลย์ลิสต์วิดีโอ HLS ต้องมีช่วงวิดีโอ (เซิร์ฟเวอร์ภาพนิ่ง JPEG ช้ามาก ~20 วิ/ภาพ จึงใช้เป็นทางสำรอง)
 */
async function checkCamera(cam) {
  try {
    if (cam.hls) {
      let res = await get(cam.hls, 12000);
      let pl = parsePlaylist(res.ok ? await res.text() : '', cam.hls);
      if (pl.ok && pl.variant) {
        res = await get(pl.variant, 12000);
        pl = parsePlaylist(res.ok ? await res.text() : '', pl.variant);
      }
      if (pl.ok && !pl.variant) return { ok: true, via: 'hls', status: res.status };
    }
    const res = await get(cam.img, 30000);
    const buf = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    return { ok: res.ok && looksLikeImage(res.headers.get('content-type'), buf.byteLength), via: 'jpeg', status: res.status, bytes: buf.byteLength };
  } catch (e) {
    // เชื่อมต่อไม่ได้/หมดเวลา: บางเซิร์ฟเวอร์รับเฉพาะผู้ใช้ในไทย จึงถือว่า "ยังตรวจไม่ได้" ไม่ใช่ "เสีย"
    return { ok: null, status: 0, error: String(e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message) };
  }
}

const DEADLINE_MS = 7 * 60 * 1000; // ตรวจไม่ทันในเวลานี้ = ยังตรวจไม่ได้

/** ตรวจแบบจำกัดจำนวนพร้อมกันต่อโฮสต์ ไม่ให้ยิงเซิร์ฟเวอร์กล้องหนักเกินไป */
async function checkAll(cams, perHost = 2) {
  const out = new Array(cams.length);
  const started = Date.now();
  const groups = new Map();
  cams.forEach((c, k) => {
    const host = new URL(c.hls || c.img).host;
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(k);
  });
  await Promise.all(
    [...groups.values()].flatMap((idx) => {
      let i = 0;
      return Array.from({ length: perHost }, async () => {
        while (i < idx.length) {
          const k = idx[i++];
          out[k] = Date.now() - started > DEADLINE_MS ? { ok: null, error: 'deadline' } : await checkCamera(cams[k]);
        }
      });
    }),
  );
  return out;
}

async function main() {
  const res = await get(ITIC_FEED_URL, 30000);
  if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
  const cams = normalizeItic(await res.json());
  if (cams.length === 0) throw new Error('ฟีดไม่มีกล้องในกรุงเทพฯ — ไม่เขียนทับไฟล์เดิม');

  const checks = await checkAll(cams);
  const now = new Date().toISOString();
  cams.forEach((c, k) => {
    c.ok = checks[k].ok;
    c.via = checks[k].via || null; // hls = เล่นวิดีโอได้, jpeg = ได้แค่ภาพนิ่ง
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
  for (const c of cams) {
    const k = `${c.org || 'อื่น ๆ'}:${c.ok ? c.via : c.ok === null ? 'ตรวจไม่ได้' : 'เสีย'}`;
    byOrg[k] = (byOrg[k] || 0) + 1;
  }
  await writeFile(
    OUT,
    `${JSON.stringify({ generatedAt: now, source: 'iTIC Foundation / Longdo Traffic', feed: ITIC_FEED_URL, total: cams.length, ok: okCount, cameras: cams }, null, 1)}\n`,
  );
  console.log(`กล้องกรุงเทพฯ ${cams.length} ตัว ภาพใช้ได้ ${okCount} ตัว`, byOrg);
  const bad = cams.map((c, k) => ({ c, r: checks[k] })).filter((x) => !x.r.ok).slice(0, 8);
  if (bad.length) console.log('ตัวอย่างที่ใช้ไม่ได้:', bad.map((x) => `${x.c.id} ${x.r.status} ${x.r.bytes ?? ''} ${x.r.error ?? ''}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
