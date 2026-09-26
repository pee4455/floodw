// กล้องจราจรจากฟีดสาธารณะของ iTIC / Longdo Traffic (https://traffic.longdo.com/feed/)
// รวมกล้องของ กทม. กรมทางหลวง การทางพิเศษ ฯลฯ — เลือกเฉพาะกรุงเทพฯ และปริมณฑล

export const ITIC_FEED_URL = 'https://camera.longdo.com/feed/?command=json';

/** กรอบกรุงเทพฯ + นนทบุรี ปทุมธานี (รังสิต) สมุทรปราการ */
export const BKK_BBOX = { minLat: 13.45, maxLat: 14.15, minLon: 100.25, maxLon: 100.95 };

const inBox = (lat, lon, b = BKK_BBOX) => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon;

/** ยอมรับเฉพาะ https และไม่ใช่ค่าตัวอย่าง/สตรีมพักใช้งานในฟีด */
function cleanUrl(u) {
  if (typeof u !== 'string' || !u.startsWith('https://')) return null;
  if (/X\.X\.X\.X|YYYY|tempsus/i.test(u)) return null;
  return u;
}

/**
 * แปลงรายการจากฟีดเป็นรูปแบบกล้องของแอป
 * @param {object[]} items ผลจาก ITIC_FEED_URL
 */
export function normalizeItic(items) {
  const out = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    const lat = Number(it.latitude);
    const lon = Number(it.longitude);
    const img = cleanUrl(it.imgurl);
    const camid = String(it.camid || '').trim();
    if (!camid || !Number.isFinite(lat) || !Number.isFinite(lon) || !img || !inBox(lat, lon)) continue;
    const id = `itic-${camid.replace(/[^\w.-]/g, '_')}`;
    if (out.has(id)) continue;
    out.set(id, {
      id,
      type: 'snapshot',
      name: String(it.title || camid).replace(/\s+/g, ' ').trim(),
      org: String(it.organization || '').trim() || null,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      img,
      video: cleanUrl(it.vdourl),
      hls: cleanUrl(it.hls_url),
    });
  }
  return [...out.values()];
}

/** ภาพที่ได้ถือว่าใช้ได้ไหม (เป็นรูปจริง ไม่ใช่หน้า error เล็ก ๆ) */
export function looksLikeImage(contentType, bytes) {
  return /^image\//i.test(contentType || '') && bytes >= 2000;
}

/**
 * ตรวจเพลย์ลิสต์ HLS
 * @returns {{ok:boolean, variant:string|null}} variant = URL เพลย์ลิสต์ย่อย (กรณีเป็น master playlist)
 */
export function parsePlaylist(text, baseUrl) {
  if (typeof text !== 'string' || !text.trimStart().startsWith('#EXTM3U')) return { ok: false, variant: null };
  if (/#EXTINF/.test(text)) return { ok: true, variant: null };
  if (/#EXT-X-STREAM-INF/.test(text)) {
    const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    if (!line) return { ok: false, variant: null };
    try {
      return { ok: true, variant: new URL(line, baseUrl).href };
    } catch {
      return { ok: false, variant: null };
    }
  }
  return { ok: false, variant: null };
}
