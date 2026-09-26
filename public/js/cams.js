// กล้อง CCTV / ไลฟ์ YouTube
// - youtube: cameras.json + สถานะไลฟ์ camera_status.json
// - snapshot: กล้องจราจรจากฟีด iTIC/Longdo (itic_cameras.json) ภาพนิ่งอัปเดตทุกไม่กี่วินาที

const STATE_ORDER = { live: 0, online: 1, unknown: 2, offline: 3, unavailable: 4 };

export const STATE_LABEL = {
  live: 'LIVE',
  online: 'ภาพสด',
  offline: 'ไม่ได้ไลฟ์ตอนนี้',
  unavailable: 'ลิงก์เสีย',
  unknown: 'ยังไม่ได้ตรวจ',
};

const YT_ID = /^[\w-]{11}$/;

/**
 * @returns {{id:string, type:string, name:string, area:string, lat:number|null, lon:number|null,
 *   videoId:string|null, state:string, channel:string|null, note?:string, tags:string[], approximate?:boolean}[]}
 */
export function resolveCameras(camerasJson, statusJson, iticJson = null) {
  const status = statusJson?.status || {};
  const youtube = (camerasJson?.cameras || []).map((c) => {
    const s = status[c.id];
    const videoId = [s?.videoId, c.videoId].find((v) => v && YT_ID.test(v)) || null;
    return { ...c, videoId, state: s?.state || 'unknown', liveTitle: s?.title || null, tags: [...(c.tags || []), 'youtube'] };
  });
  const snapshots = (iticJson?.cameras || [])
    .filter((c) => c && c.type === 'snapshot' && isHttps(c.img) && Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map((c) => ({
      ...c,
      video: isHttps(c.video) ? c.video : null,
      hls: isHttps(c.hls) ? c.hls : null,
      area: c.org || 'กล้องจราจร',
      videoId: null,
      // ok: true = ตรวจแล้วใช้ได้, null = ตรวจจากเซิร์ฟเวอร์ต่างประเทศไม่ได้ (อาจเปิดได้ในไทย), false = เสีย
      state: c.ok === true ? 'online' : c.ok === false ? 'offline' : 'unknown',
      tags: ['traffic'],
    }));
  return [...youtube, ...snapshots].sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
}

const isHttps = (u) => typeof u === 'string' && u.startsWith('https://');

/** URL ภาพนิ่งล่าสุด (ใส่ตัวแปรเวลากันแคช) */
export const snapshotUrl = (c, now = Date.now()) => `${c.img}${c.img.includes('?') ? '&' : '?'}_=${Math.floor(now / 1000)}`;

/** เรียงตามระยะจากจุดที่เลือก (กล้องไม่มีพิกัดไว้ท้าย) */
export function sortByDistance(cams, point) {
  return cams
    .map((c) => ({ ...c, distance: hasLocation(c) && point ? distanceKm(point, c) : null }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
}

export const hasLocation = (c) => Number.isFinite(c.lat) && Number.isFinite(c.lon);

/** เปิดดูในแอปได้ไหม: YouTube ที่มี videoId และไม่เสีย / กล้องจราจรที่ตรวจแล้วว่าส่งภาพได้ */
export const canEmbed = (c) =>
  (c.type === 'youtube' && !!c.videoId && c.state !== 'unavailable') ||
  (c.type === 'snapshot' && (c.state === 'online' || c.state === 'unknown'));

export const embedUrl = (id) =>
  `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&rel=0`;

export const thumbUrl = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

/** ลิงก์เปิดใน YouTube (ถ้าไม่มี videoId ใช้หน้า live ของช่อง) */
export function watchUrl(c) {
  if (c.type === 'snapshot') return c.video || c.img || null;
  if (c.videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(c.videoId)}`;
  if (c.channel && /^@[\w.-]+$/.test(c.channel)) return `https://www.youtube.com/${c.channel}/live`;
  return c.url || null;
}

/** ระยะทาง (กม.) แบบ haversine */
export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** กล้องที่เปิดดูได้ใกล้จุดหนึ่งที่สุด ภายในระยะ maxKm */
export function nearestCamera(cams, point, maxKm = 3) {
  let best = null;
  for (const c of cams) {
    if (!hasLocation(c) || !canEmbed(c)) continue;
    const d = distanceKm(point, c);
    if (d <= maxKm && (!best || d < best.d)) best = { cam: c, d };
  }
  return best;
}
