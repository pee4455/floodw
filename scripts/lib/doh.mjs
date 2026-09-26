// กล้องทางหลวงจากเว็บกรมทางหลวง highwaytraffic.go.th (ASP.NET PageMethods: GetSiteInfo / GetCameraInfo)

export const DOH_BASE = 'https://highwaytraffic.go.th/DOHWeb';

/** รายการจุดกล้องจากหน้า home.aspx: MoveLocation2(id) + รหัสจุด เช่น PER-3-003 */
export function parseSiteIds(html) {
  const out = new Map();
  for (const m of String(html).matchAll(/MoveLocation2\((\d+)\)['"]?\s*>\s*([A-Za-z0-9_-]+)\s*</g)) {
    out.set(Number(m[1]), m[2]);
  }
  return [...out].map(([id, code]) => ({ id, code }));
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** ผลของ GetSiteInfo: {"d":["lat","lon","code","<table>…ชื่อจุดติดตั้ง…รายละเอียด…</table>"]} */
export function parseSiteInfo(d) {
  if (!Array.isArray(d) || d.length < 3) return null;
  const lat = Number(d[0]);
  const lon = Number(d[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  const table = String(d[3] || '');
  const name = table.match(/ชื่อจุดติดตั้ง[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
  const detail = table.match(/รายละเอียด[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/);
  return { lat, lon, code: String(d[2] || '').trim(), name: stripTags(name?.[1]), detail: stripTags(detail?.[1]) };
}

/** ผลของ GetCameraInfo: HTML ที่มี site_code="https://…/playlist.m3u8" ของขาเข้า/ขาออก */
export function parseCameraInfo(html) {
  const s = String(html || '');
  const dirIn = stripTags(s.match(/TxtDirectIn"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
  const dirOut = stripTags(s.match(/TxtDirectOut"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
  const streams = [];
  for (const m of s.matchAll(/id="[^"]*playerElement0(\d)"[^>]*site_code="(https:\/\/[^"]+\.m3u8)"/g)) {
    const isIn = m[1] === '1';
    streams.push({ label: (isIn ? dirIn : dirOut) || (isIn ? 'ขาเข้า' : 'ขาออก'), hls: m[2] });
  }
  return streams;
}

/** รหัสกล้องทางหลวงจาก camid ของ iTIC เช่น DOH-PER-3-006-out → PER-3-006 (ใช้ตัดกล้องซ้ำ) */
export function dohCodeFromItic(camid) {
  const m = String(camid || '').match(/^DOH-(PER-\d+-\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

/** ส่วนท้ายของ URL สตรีมที่ใช้จับคู่ระหว่างกรมทางหลวงกับ iTIC เช่น phase3/per_3_006_in.stream */
export function streamKey(url) {
  const m = String(url || '').match(/\/(Phase\d+\/[^/]+\.stream)\//i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * รวมกล้องกรมทางหลวงกับ iTIC: สตรีมที่ iTIC ส่งต่อ (relay) ใช้เป็นหลักเพราะเปิดให้เว็บอื่นเล่นได้ (CORS)
 * ส่วนสตรีมตรงของกรมทางหลวงเก็บเป็นสำรอง (alt) — กล้อง iTIC ที่จับคู่ได้จะถูกรวมเข้าไป ไม่แสดงซ้ำ
 * @returns {{doh: object[], itic: object[]}}
 */
export function mergeDohWithItic(dohCams, iticCams) {
  const relay = new Map();
  for (const c of iticCams) {
    const k = streamKey(c.hls);
    if (k) relay.set(k, c);
  }
  const used = new Set();
  const doh = dohCams.map((cam) => ({
    ...cam,
    streams: cam.streams.map((st) => {
      const r = relay.get(streamKey(st.hls));
      if (!r) return { ...st };
      used.add(r.id);
      return { label: st.label, hls: r.hls, alt: st.hls };
    }),
  }));
  const dohCodes = new Set(dohCams.map((c) => c.code));
  const itic = iticCams.filter((c) => !used.has(c.id) && !dohCodes.has(dohCodeFromItic(c.code)));
  return { doh, itic };
}
