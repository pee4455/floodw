// ตัวช่วยทั่วไป (escape HTML, จัดรูปแบบเวลา/ตัวเลข)

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** escape ข้อความก่อนใส่ใน HTML — ข้อมูลข่าวมาจากภายนอก ต้อง escape เสมอ */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** อนุญาตเฉพาะลิงก์ http/https */
export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

const dtFmt = new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
const dFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' });

export function fmtDateTime(iso) {
  if (!iso) return 'ไม่ทราบเวลา';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'ไม่ทราบเวลา' : `${dtFmt.format(d)} น.`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dFmt.format(d);
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return 'ไม่ทราบเวลา';
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'เมื่อสักครู่';
  if (diff < 3600) return `${Math.floor(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ชม. ที่แล้ว`;
  return `${Math.floor(diff / 86400)} วันที่แล้ว`;
}

export function depthLabel(depthCm) {
  if (!depthCm) return 'ไม่ระบุ';
  const [a, b] = depthCm;
  return a === b ? `${a} ซม.` : `${a}–${b} ซม.`;
}

export const mm = (v, digits = 1) => (v == null ? '–' : `${v.toFixed(digits)} มม.`);
export const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)}%`);

/** วันที่ปัจจุบันตามเวลาไทย รูปแบบ YYYY-MM-DD */
export const bangkokToday = (now = Date.now()) => new Date(now + 7 * 3600e3).toISOString().slice(0, 10);

/** สถานะที่จอดรถตามช่วงวันที่ (เทียบเวลาไทย) */
export function parkingState(p, now = Date.now()) {
  const today = bangkokToday(now);
  if (p.until && today > p.until) return 'closed';
  if (p.from && today < p.from) return 'soon';
  return 'open';
}

/** ข้อความสำหรับค้นหา: ตัวพิมพ์เล็ก ตัดช่องว่าง (พิมพ์ "ฟิวเจอร์ พาร์ค" หรือ "ฟิวเจอร์พาร์ค" ก็เจอ) */
export const searchKey = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

/**
 * กรองที่จอดรถ
 * @param {object[]} list
 * @param {{q?:string, filter?:''|'open'|'bkk'|'free'}} opts
 */
export function filterParking(list, { q = '', filter = '' } = {}, now = Date.now()) {
  const key = searchKey(q);
  return (list || []).filter((p) => {
    if (filter === 'open' && parkingState(p, now) !== 'open') return false;
    if (filter === 'bkk' && !p.inBangkok) return false;
    if (filter === 'free' && !p.free) return false;
    if (!key) return true;
    return searchKey([p.name, p.area, p.floors, p.conditions, p.contact].join(' ')).includes(key);
  });
}
