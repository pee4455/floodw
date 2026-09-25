// กล้อง CCTV / ไลฟ์ YouTube — รวมข้อมูลกล้อง (cameras.json) กับสถานะล่าสุด (camera_status.json)

const STATE_ORDER = { live: 0, unknown: 1, offline: 2, unavailable: 3 };

export const STATE_LABEL = {
  live: 'LIVE',
  offline: 'ไม่ได้ไลฟ์ตอนนี้',
  unavailable: 'ลิงก์เสีย',
  unknown: 'ยังไม่ได้ตรวจ',
};

const YT_ID = /^[\w-]{11}$/;

/**
 * @returns {{id:string, type:string, name:string, area:string, lat:number|null, lon:number|null,
 *   videoId:string|null, state:string, channel:string|null, note?:string, tags:string[], approximate?:boolean}[]}
 */
export function resolveCameras(camerasJson, statusJson) {
  const status = statusJson?.status || {};
  return (camerasJson?.cameras || [])
    .map((c) => {
      const s = status[c.id];
      const videoId = [s?.videoId, c.videoId].find((v) => v && YT_ID.test(v)) || null;
      return { ...c, videoId, state: s?.state || 'unknown', liveTitle: s?.title || null, tags: c.tags || [] };
    })
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
}

export const hasLocation = (c) => Number.isFinite(c.lat) && Number.isFinite(c.lon);

/** เล่นในแอปได้ไหม (มี videoId และไม่ใช่ลิงก์เสีย) */
export const canEmbed = (c) => c.type === 'youtube' && !!c.videoId && c.state !== 'unavailable';

export const embedUrl = (id) =>
  `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&playsinline=1&rel=0`;

export const thumbUrl = (id) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

/** ลิงก์เปิดใน YouTube (ถ้าไม่มี videoId ใช้หน้า live ของช่อง) */
export function watchUrl(c) {
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
