// ที่จอดรถทั่วไป: เวลาเปิด-ปิด (รูปแบบ opening_hours ของ OSM), ค่าจอด, ประมาณค่าจอด, รวมค่าจอดที่ผู้ดูแลตรวจสอบ (pure — ทดสอบได้)
import { searchKey } from './util.js';

/**
 * โมเดลค่าจอด (ทุกช่องไม่บังคับ):
 *   free       จอดฟรีตลอด
 *   freeHours  จอดฟรี N ชม. แรก (freeFor: 'customers' = เฉพาะลูกค้า/ประทับตรา)
 *   firstHours + firstThb  N ชม. แรกเหมา X บาท
 *   perHour    ชั่วโมงละ / ชั่วโมงถัดไป
 *   perDay     เหมาวันละ
 *   flat       ครั้งละ (ไม่คิดตามเวลา)
 *   capDay     สูงสุดต่อวัน
 *   paid       เสียค่าจอดแต่ไม่ทราบราคา · note ข้อความเพิ่มเติม
 */

export const KIND_LABEL = {
  mall: 'ห้าง/ศูนย์การค้า',
  building: 'อาคารจอดรถ',
  underground: 'ใต้ดิน',
  park_ride: 'จอดแล้วจร',
  surface: 'ลานจอด',
};

const DAY_CODES = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function parseDays(sel) {
  const out = new Set();
  for (const tok of sel.split(',')) {
    const [a, b] = tok.split('-');
    if (a === 'PH' || a === 'SH') continue; // วันหยุดนักขัตฤกษ์ — ไม่รู้วันที่ จึงข้าม
    if (!(a in DAY_CODES) || (b && !(b in DAY_CODES))) return null;
    if (!b) out.add(DAY_CODES[a]);
    else for (let d = DAY_CODES[a]; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === DAY_CODES[b]) break;
    }
  }
  return out;
}

function parseTimes(s) {
  if (/^(off|closed)$/i.test(s)) return [];
  const out = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/);
    if (!m) return null;
    const start = +m[1] * 60 + +m[2];
    let end = +m[3] * 60 + +m[4];
    if (start > 1440 || end > 1440) return null;
    if (end <= start) end += 1440; // ข้ามเที่ยงคืน เช่น 10:00-02:00
    out.push([start, end]);
  }
  return out;
}

/**
 * แปลง opening_hours (ชุดย่อยที่พบบ่อยในกรุงเทพฯ) → { always:true } | { days: {0..6: [[startMin,endMin]]} }
 * อ่านไม่ออก → null (แสดงว่าไม่ทราบเวลา ดีกว่าแสดงผิด)
 */
export function parseOpeningHours(str) {
  if (!str || typeof str !== 'string') return null;
  let s = str
    .trim()
    .replace(/(\d{1,2})\.(\d{2})/g, '$1:$2')
    .replace(/\s*hrs?\.?$/i, '')
    .replace(/\s*-\s*/g, '-');
  if (s === '24/7') return { always: true };
  const days = {};
  const rules = s.split(/\s*;\s*|(?<=\d)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH))/).filter(Boolean);
  for (const rule of rules) {
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?)+)?\s*(.*)$/);
    const sel = m[1]?.replace(/,$/, '');
    const rest = m[2].trim();
    const ds = sel ? parseDays(sel) : new Set(ALL_DAYS);
    if (!ds) return null;
    if (!ds.size) continue; // กฎเฉพาะ PH
    const times = rest === '' || /^open$/i.test(rest) ? [[0, 1440]] : parseTimes(rest);
    if (!times) return null;
    for (const d of ds) days[d] = times; // กฎหลังทับกฎก่อน (ตามมาตรฐาน OSM)
  }
  if (!Object.keys(days).length) return null;
  if (ALL_DAYS.every((d) => days[d]?.some(([a, b]) => a === 0 && b >= 1440))) return { always: true };
  return { days };
}

const hhmm = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** เวลาไทย: วันในสัปดาห์ (0=อาทิตย์) และนาทีนับจากเที่ยงคืน */
function bangkokClock(now) {
  const d = new Date(now + 7 * 3600e3);
  return { dow: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/**
 * สถานะเปิด-ปิดตอนนี้ (เวลาไทย)
 * @returns {{state:'open'|'soon'|'closed'|'unknown', label:string}}
 */
export function openStatus(hours, now = Date.now(), soonMin = 60) {
  const oh = typeof hours === 'string' ? parseOpeningHours(hours) : hours;
  if (!oh) return { state: 'unknown', label: 'ไม่มีข้อมูลเวลาเปิด-ปิด' };
  if (oh.always) return { state: 'open', label: 'เปิด 24 ชม.' };
  const { dow, min } = bangkokClock(now);
  const today = oh.days[dow] || [];
  const yesterday = (oh.days[(dow + 6) % 7] || []).map(([a, b]) => [a - 1440, b - 1440]);
  const cur = [...yesterday, ...today].find(([a, b]) => min >= a && min < b);
  if (cur) {
    if (cur[0] <= 0 && cur[1] >= 1440) return { state: 'open', label: 'เปิด 24 ชม.' };
    const left = cur[1] - min;
    return left <= soonMin ? { state: 'soon', label: `กำลังจะปิด · ปิด ${hhmm(cur[1])}` } : { state: 'open', label: `เปิด · ปิด ${hhmm(cur[1])}` };
  }
  const next = today.filter(([a]) => a > min).sort((x, y) => x[0] - y[0])[0];
  return { state: 'closed', label: next ? `ปิด · เปิด ${hhmm(next[0])}` : 'ปิดแล้ววันนี้' };
}

/** มีราคาที่ใช้ประมาณค่าจอด/กรอง "ฟรี" ได้ */
export function hasPrice(rate) {
  return !!rate && (rate.free || rate.freeHours > 0 || rate.perHour != null || rate.perDay != null || rate.flat != null || rate.firstThb != null);
}

/** ข้อความค่าจอด เช่น "จอดฟรี 2 ชม. · ชม. ถัดไป 20 บาท · สูงสุด 240 บาท/วัน" */
export function rateLabel(rate) {
  if (!rate) return 'ไม่มีข้อมูลค่าจอด';
  if (rate.free) return 'จอดฟรี';
  const parts = [];
  const head = rate.freeHours > 0 || rate.firstHours > 0;
  if (rate.freeHours > 0) parts.push(`จอดฟรี ${rate.freeHours} ชม.${rate.freeFor === 'customers' ? ' (ลูกค้า)' : ''}`);
  else if (rate.firstHours > 0 && rate.firstThb != null) parts.push(`${rate.firstHours === 1 ? 'ชม. แรก' : `${rate.firstHours} ชม. แรก`} ${rate.firstThb} บาท`);
  if (rate.flat != null) parts.push(`ครั้งละ ${rate.flat} บาท`);
  if (rate.perHour != null) parts.push(head ? `ชม. ถัดไป ${rate.perHour} บาท` : `ชม. ละ ${rate.perHour} บาท`);
  if (rate.perDay != null) parts.push(`วันละ ${rate.perDay} บาท`);
  if (rate.capDay != null) parts.push(`สูงสุด ${rate.capDay} บาท/วัน`);
  if (rate.note) parts.push(rate.note);
  if (!parts.length) return rate.paid ? 'เสียค่าจอด (ยังไม่มีข้อมูลราคา)' : 'ไม่มีข้อมูลค่าจอด';
  return parts.join(' · ');
}

/** ประมาณค่าจอด (บาท) เมื่อจอด `hours` ชั่วโมง — คิดเศษชั่วโมงเป็น 1 ชม. · ข้อมูลไม่พอ → null */
export function estimateCost(rate, hours) {
  if (!rate || !(hours > 0)) return null;
  if (rate.free) return 0;
  if (rate.flat != null) return rate.flat;
  const days = Math.ceil(hours / 24);
  if (rate.perDay != null && rate.perHour == null && !(rate.freeHours > 0) && rate.firstThb == null) return rate.perDay * days;
  let cost = 0;
  let covered = 0;
  if (rate.freeHours > 0) covered = rate.freeHours;
  else if (rate.firstHours > 0 && rate.firstThb != null) {
    covered = rate.firstHours;
    cost = rate.firstThb;
  } else if (rate.perHour == null) return null;
  const rest = Math.ceil(Math.max(0, hours - covered));
  if (rest > 0) {
    if (rate.perHour == null) return null;
    cost += rest * rate.perHour;
  }
  if (rate.capDay != null) cost = Math.min(cost, rate.capDay * days);
  if (rate.perDay != null) cost = Math.min(cost, rate.perDay * days);
  return cost;
}

/** ข้อควรระวังช่วงน้ำท่วมตามประเภทที่จอด */
export function floodNote(v) {
  if (v.kind === 'underground') return { level: 'warn', text: 'ที่จอดใต้ดิน — เสี่ยงน้ำท่วม เลี่ยงช่วงฝนตกหนัก' };
  if (v.kind === 'building') return { level: 'ok', text: `อาคารจอดรถ${v.levels ? ` ${v.levels} ชั้น` : ''} — ช่วงน้ำท่วมเลือกจอดชั้นบน` };
  return null;
}

/**
 * รวมค่าจอดที่ผู้ดูแลตรวจสอบจากแหล่งทางการ (parking_rates.json) เข้ากับข้อมูล OSM
 * รายการที่มี `osm` = แทนที่ข้อมูลของที่จอดนั้น · ไม่มี `osm` แต่มีพิกัด = เพิ่มเป็นที่จอดใหม่
 */
export function mergeRates(osmVenues, rates) {
  const list = (osmVenues || []).map((v) => ({ ...v }));
  const byId = new Map(list.map((v) => [v.id, v]));
  (rates?.venues || []).forEach((r, i) => {
    const verified = { source: r.source || null, checkedAt: r.checkedAt || null };
    const patch = {
      ...(r.name ? { name: r.name } : {}),
      ...(r.nameEn ? { nameEn: r.nameEn } : {}),
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.hours ? { hours: r.hours } : {}),
      ...(r.rate ? { rate: r.rate } : {}),
      ...(r.rateNote ? { rateNote: r.rateNote } : {}),
      verified,
    };
    const target = r.osm && byId.get(r.osm);
    if (target) Object.assign(target, patch);
    else if (r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      list.push({ id: `rate/${i}`, named: true, kind: 'surface', lat: r.lat, lon: r.lon, ...patch });
    }
  });
  return list;
}

/**
 * กรองที่จอด
 * filter: '' | 'open' | 'priced' | 'free' | 'building' | 'park_ride' | 'mall'
 */
export function filterVenues(list, { q = '', filter = '' } = {}, now = Date.now()) {
  const key = searchKey(q);
  return (list || []).filter((v) => {
    if (filter === 'open' && !['open', 'soon'].includes(openStatus(v.hours, now).state)) return false;
    if (filter === 'priced' && !hasPrice(v.rate)) return false;
    if (filter === 'free' && !(v.rate?.free || v.rate?.freeHours > 0)) return false;
    if (['building', 'park_ride', 'mall'].includes(filter) && v.kind !== filter) return false;
    if (!key) return true;
    return searchKey([v.name, v.nameEn, v.operator, KIND_LABEL[v.kind]].join(' ')).includes(key);
  });
}
