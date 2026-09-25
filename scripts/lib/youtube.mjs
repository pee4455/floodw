// อ่านสถานะวิดีโอ/ไลฟ์จากหน้า HTML ของ YouTube (ไม่ใช้ API key)

/**
 * @param {string} html หน้า watch?v=… หรือ /@channel/live
 * @returns {{videoId:string|null, title:string|null, isLiveNow:boolean, isLiveContent:boolean, playability:string|null}}
 */
export function parseWatchPage(html) {
  const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/);
  const title = html.match(/<meta name="title" content="([^"]*)"/);
  const playability = html.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/);
  return {
    videoId: canonical ? canonical[1] : null,
    title: title ? decodeHtml(title[1]) : null,
    isLiveNow: /"isLiveNow":\s*true/.test(html),
    isLiveContent: /"isLiveContent":\s*true/.test(html),
    playability: playability ? playability[1] : null,
  };
}

const decodeHtml = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

/**
 * สรุปสถานะกล้อง
 * - live: กำลังถ่ายทอดสด
 * - offline: วิดีโอยังอยู่แต่ไม่ได้ไลฟ์ตอนนี้ (หรือช่องไม่มีไลฟ์)
 * - unavailable: วิดีโอถูกลบ/ปิด/ส่วนตัว
 */
export function cameraState(page) {
  if (!page || !page.videoId) return 'offline';
  if (page.playability && !['OK', 'LIVE_STREAM_OFFLINE'].includes(page.playability)) return 'unavailable';
  if (page.isLiveNow) return 'live';
  return 'offline';
}
