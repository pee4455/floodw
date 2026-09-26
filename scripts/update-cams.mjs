#!/usr/bin/env node
// รวมกล้องจราจรกรุงเทพฯ/ปริมณฑลจาก 2 แหล่ง แล้วตรวจว่าแต่ละกล้องส่งภาพ/วิดีโอได้จริง
//   1) ฟีดสาธารณะ iTIC / Longdo Traffic
//   2) เว็บกรมทางหลวง highwaytraffic.go.th (วิดีโอ HLS ขาเข้า/ขาออก)
// → public/data/traffic_cameras.json (รันทุก 30 นาทีใน GitHub Actions)
// รันเอง: npm run update-cams
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ITIC_FEED_URL, BKK_BBOX, normalizeItic, looksLikeImage, parsePlaylist } from './lib/itic.mjs';
import { DOH_BASE, parseSiteIds, parseSiteInfo, parseCameraInfo, dohCodeFromItic } from './lib/doh.mjs';

const OUT = fileURLToPath(new URL('../public/data/traffic_cameras.json', import.meta.url));
const UA = 'Mozilla/5.0 (compatible; BangkokFloodWatch/1.0; +https://github.com/pee4455/floodw)';
const DEADLINE_MS = 8 * 60 * 1000; // ตรวจไม่ทันในเวลานี้ = ยังตรวจไม่ได้
const started = Date.now();

async function request(url, { timeout = 15000, ...opts } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'user-agent': UA, referer: 'https://pee4455.github.io/floodw/', ...(opts.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

/** รันงานแบบจำกัดจำนวนพร้อมกัน (ไม่ยิงเซิร์ฟเวอร์ต้นทางหนักเกินไป) */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

const netError = (e) => String(e.name === 'AbortError' ? 'timeout' : e.cause?.code || e.message);

// ---------- แหล่ง 1: iTIC ----------
async function fetchItic() {
  const res = await request(ITIC_FEED_URL, { timeout: 30000 });
  if (!res.ok) throw new Error(`iTIC feed HTTP ${res.status}`);
  return normalizeItic(await res.json()).map((c) => ({ ...c, source: 'itic' }));
}

// ---------- แหล่ง 2: กรมทางหลวง ----------
async function pageMethod(method, siteID) {
  const res = await request(`${DOH_BASE}/home.aspx/${method}`, {
    method: 'POST',
    timeout: 20000,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ siteID }),
  });
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
  return (await res.json()).d;
}

async function fetchDoh() {
  const res = await request(`${DOH_BASE}/home.aspx`, { timeout: 30000 });
  if (!res.ok) throw new Error(`highwaytraffic HTTP ${res.status}`);
  const sites = parseSiteIds(await res.text());
  const infos = await mapLimit(sites, 4, async (s) => {
    try {
      return parseSiteInfo(await pageMethod('GetSiteInfo', s.id));
    } catch {
      return null;
    }
  });
  const inBox = (i) => i && i.lat >= BKK_BBOX.minLat && i.lat <= BKK_BBOX.maxLat && i.lon >= BKK_BBOX.minLon && i.lon <= BKK_BBOX.maxLon;
  const local = sites.map((s, k) => ({ ...s, info: infos[k] })).filter((s) => inBox(s.info));
  const cams = await mapLimit(local, 3, async (s) => {
    let streams = [];
    try {
      streams = parseCameraInfo(await pageMethod('GetCameraInfo', s.id));
    } catch {
      /* ข้ามจุดที่ดึงไม่ได้ */
    }
    if (!streams.length) return null;
    const code = (s.info.code || s.code).toUpperCase();
    return {
      id: `doh-${code}`,
      type: 'snapshot',
      source: 'doh',
      code,
      name: s.info.name || code,
      detail: s.info.detail || null,
      org: 'กรมทางหลวง',
      lat: Math.round(s.info.lat * 1e5) / 1e5,
      lon: Math.round(s.info.lon * 1e5) / 1e5,
      img: null,
      video: null,
      hls: streams[0].hls,
      streams,
    };
  });
  console.log(`highwaytraffic: ทั้งหมด ${sites.length} จุด อยู่ในกรุงเทพฯ/ปริมณฑล ${local.length} จุด`);
  return cams.filter(Boolean);
}

// ---------- ตรวจกล้อง ----------
/** เพลย์ลิสต์ HLS ต้องมีช่วงวิดีโอจริง + บันทึกว่าเปิด CORS ไหม (hls.js ในเบราว์เซอร์ที่ไม่ใช่ Safari ต้องใช้) */
async function checkHls(url) {
  try {
    let res = await request(url, { timeout: 12000, headers: { origin: 'https://pee4455.github.io' } });
    const cors = !!res.headers.get('access-control-allow-origin');
    let pl = parsePlaylist(res.ok ? await res.text() : '', url);
    if (pl.ok && pl.variant) {
      res = await request(pl.variant, { timeout: 12000 });
      pl = parsePlaylist(res.ok ? await res.text() : '', pl.variant);
    }
    return { ok: pl.ok && !pl.variant, cors };
  } catch (e) {
    // เชื่อมต่อไม่ได้/หมดเวลา: บางเซิร์ฟเวอร์รับเฉพาะผู้ใช้ในไทย จึงถือว่า "ยังตรวจไม่ได้" ไม่ใช่ "เสีย"
    return { ok: null, error: netError(e) };
  }
}

async function checkImage(url) {
  try {
    const res = await request(url, { timeout: 30000 });
    const buf = res.ok ? await res.arrayBuffer() : new ArrayBuffer(0);
    return { ok: res.ok && looksLikeImage(res.headers.get('content-type'), buf.byteLength) };
  } catch (e) {
    return { ok: null, error: netError(e) };
  }
}

const merge = (results) => (results.some((r) => r.ok === true) ? true : results.some((r) => r.ok === null) ? null : false);

async function checkCamera(cam) {
  if (Date.now() - started > DEADLINE_MS) return { ok: null, error: 'deadline' };
  if (cam.streams?.length) {
    const rs = [];
    for (const s of cam.streams) {
      const r = await checkHls(s.hls);
      s.ok = r.ok;
      s.cors = r.cors ?? null;
      rs.push(r);
    }
    const good = cam.streams.find((s) => s.ok) || cam.streams[0];
    cam.hls = good.hls;
    return { ok: merge(rs), via: 'hls', cors: good.cors, error: rs.find((r) => r.error)?.error };
  }
  if (cam.hls) {
    const r = await checkHls(cam.hls);
    if (r.ok) return { ok: true, via: 'hls', cors: r.cors };
    if (!cam.img) return r;
  }
  if (cam.img) return { ...(await checkImage(cam.img)), via: 'jpeg' };
  return { ok: false };
}

/** ตรวจแบบจำกัดจำนวนพร้อมกันต่อโฮสต์ */
async function checkAll(cams, perHost = 2) {
  const out = new Array(cams.length);
  const groups = new Map();
  cams.forEach((c, k) => {
    const host = new URL(c.hls || c.img).host;
    if (!groups.has(host)) groups.set(host, []);
    groups.get(host).push(k);
  });
  await Promise.all(
    [...groups.values()].map((idx) => mapLimit(idx, perHost, async (k) => (out[k] = await checkCamera(cams[k])))),
  );
  return out;
}

async function main() {
  const [itic, doh] = await Promise.allSettled([fetchItic(), fetchDoh()]);
  const sources = { itic: itic.status === 'fulfilled', doh: doh.status === 'fulfilled' };
  if (!sources.itic) console.error('iTIC:', itic.reason?.message);
  if (!sources.doh) console.error('highwaytraffic:', doh.reason?.message);
  const dohCams = sources.doh ? doh.value : [];
  const dohCodes = new Set(dohCams.map((c) => c.code));
  // กล้องทางหลวงที่ iTIC ส่งต่อมาซ้ำกับของกรมทางหลวงโดยตรง → ใช้ของกรมทางหลวง (มีทั้งขาเข้า/ขาออก)
  const iticCams = (sources.itic ? itic.value : []).filter((c) => !dohCodes.has(dohCodeFromItic(c.code)));
  const cams = [...dohCams, ...iticCams];
  if (cams.length === 0) throw new Error('ไม่มีกล้องจากทั้งสองแหล่ง — ไม่เขียนทับไฟล์เดิม');

  const checks = await checkAll(cams);
  const now = new Date().toISOString();
  cams.forEach((c, k) => {
    c.ok = checks[k].ok;
    c.via = checks[k].via || null; // hls = เล่นวิดีโอได้, jpeg = ได้แค่ภาพนิ่ง
    c.cors = checks[k].cors ?? null;
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
      console.error('ตรวจไม่ผ่านเลยสักกล้อง — ไม่เขียนทับไฟล์เดิม', checks.slice(0, 5));
      process.exitCode = 1;
      return;
    }
  }
  const summary = {};
  for (const c of cams) {
    const k = `${c.source}:${c.org || '-'}:${c.ok ? `${c.via}${c.cors === false ? '(no-cors)' : ''}` : c.ok === null ? 'ตรวจไม่ได้' : 'เสีย'}`;
    summary[k] = (summary[k] || 0) + 1;
  }
  await writeFile(
    OUT,
    `${JSON.stringify(
      {
        generatedAt: now,
        sources: [
          { name: 'iTIC Foundation / Longdo Traffic', url: ITIC_FEED_URL, ok: sources.itic },
          { name: 'กรมทางหลวง highwaytraffic.go.th', url: `${DOH_BASE}/home.aspx`, ok: sources.doh },
        ],
        total: cams.length,
        ok: okCount,
        cameras: cams,
      },
      null,
      1,
    )}\n`,
  );
  console.log(`กล้อง ${cams.length} ตัว ใช้ได้ ${okCount} ตัว`, summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
