// แปลงข้อมูลที่จอดรถจาก OpenStreetMap (Overpass API) เป็นรายการที่หน้าเว็บใช้ได้ทันที (pure — ทดสอบได้)
// ข้อมูล © OpenStreetMap contributors, ODbL — ต้องแสดงที่มาทุกครั้งที่ใช้

/** กรุงเทพฯ + ปริมณฑล (ใต้, ตะวันตก, เหนือ, ตะวันออก) */
export const PARKING_BBOX = [13.49, 100.32, 14.08, 100.95];

export const OVERPASS_URLS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export function overpassQuery([s, w, n, e] = PARKING_BBOX) {
  const bb = `(${s},${w},${n},${e})`;
  return `[out:json][timeout:120];(nwr["amenity"="parking"]${bb};nwr["shop"="mall"]["name"]${bb};);out center tags;`;
}

const BIG_TYPES = new Set(['multi-storey', 'underground', 'rooftop']);
const NO_ACCESS = new Set(['private', 'no', 'permit']);
const FALLBACK_NAME = {
  building: 'อาคารจอดรถ',
  underground: 'ที่จอดรถใต้ดิน',
  park_ride: 'ที่จอดแล้วจร',
  surface: 'ลานจอดรถ',
};

const num = (v) => {
  const n = Number.parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** ประเภทที่จอด: mall / park_ride / building / underground / surface */
export function parkingKind(t) {
  if (t.shop === 'mall') return 'mall';
  if (t.park_ride && t.park_ride !== 'no') return 'park_ride';
  if (t.parking === 'underground') return 'underground';
  if (t.parking === 'multi-storey' || t.parking === 'rooftop' || (t.building && t.building !== 'no')) return 'building';
  return 'surface';
}

/** หน่วยเวลาของค่าจอด: "/hour" "/h" "/ชม." "/ชั่วโมง" → hour, "/day" "/วัน" → day */
function chargeUnit(s) {
  if (/\/\s*(hours?|h|hr|ชม\.?|ชั่วโมง)\b/i.test(s) || /\/\s*(ชม|ชั่วโมง)/.test(s)) return 'hour';
  if (/\/\s*(days?|d|วัน)\b/i.test(s) || /\/\s*วัน/.test(s)) return 'day';
  return null;
}

/**
 * แปลงแท็ก fee / charge / charge:conditional เป็นโมเดลค่าจอด (ดู public/js/parking.js)
 * ไม่มีข้อมูลเลย → null
 */
export function parseOsmRate(t) {
  const fee = String(t.fee || '').toLowerCase();
  if (fee === 'no') return { free: true };
  const rate = {};
  const charge = String(t.charge || '').split(';')[0].trim();
  const m = charge.match(/(\d+(?:[.,]\d+)?)\s*(THB|บาท|฿|B)?/i);
  if (m) {
    const amount = num(m[1]);
    const unit = chargeUnit(charge);
    if (unit === 'hour') rate.perHour = amount;
    else if (unit === 'day') rate.perDay = amount;
    else rate.note = `ค่าจอด ${amount} บาท (ไม่ระบุว่าต่อชั่วโมงหรือต่อครั้ง)`;
  }
  // เช่น "no @ (customers AND stay < 1 hours)" = ลูกค้าจอดฟรีชั่วโมงแรก
  const cond = String(t['charge:conditional'] || t['fee:conditional'] || '');
  const free = cond.match(/no\s*@\s*\(([^)]*?)stay\s*<\s*(\d+(?:\.\d+)?)\s*(hours?|h|minutes?|min)/i);
  if (free) {
    const n = num(free[2]);
    rate.freeHours = /min/i.test(free[3]) ? +(n / 60).toFixed(2) : n;
    if (/customers/i.test(free[1])) rate.freeFor = 'customers';
  }
  if (Object.keys(rate).length) return rate;
  return fee === 'yes' ? { paid: true } : null;
}

/** พิกัดของ node / way / relation (Overpass "out center") */
function coords(el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return Number.isFinite(lat) && Number.isFinite(lon) ? [+lat.toFixed(6), +lon.toFixed(6)] : null;
}

/** ที่จอดที่ควรแสดง: เปิดให้คนทั่วไป และมีข้อมูลพอให้ระบุได้ (ลานไม่มีชื่อเล็ก ๆ จะรกแผนที่) */
export function isUseful(t) {
  if (t.shop === 'mall') return !!t.name;
  if (t.amenity !== 'parking') return false;
  if (NO_ACCESS.has(t.access)) return false;
  if (t.parking === 'street_side' || t.parking === 'lane' || t.parking === 'on_kerb') return false;
  return !!(t.name || t['name:th'] || BIG_TYPES.has(t.parking) || (t.park_ride && t.park_ride !== 'no') || t.fee || num(t.capacity) >= 20);
}

/** แปลง element จาก Overpass เป็นรายการที่จอด เรียงตามชื่อ */
export function normalizeOsmParking(elements) {
  const out = [];
  const seen = new Set();
  for (const el of elements || []) {
    const t = el.tags || {};
    if (!isUseful(t)) continue;
    const pos = coords(el);
    if (!pos) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const kind = parkingKind(t);
    const v = {
      id,
      name: t['name:th'] || t.name || FALLBACK_NAME[kind],
      named: !!(t['name:th'] || t.name),
      kind,
      lat: pos[0],
      lon: pos[1],
    };
    const en = t['name:en'] || (t.name && /^[\x20-\x7e]+$/.test(t.name) && t.name !== v.name ? t.name : null);
    if (en && en !== v.name) v.nameEn = en;
    const cap = num(t.capacity);
    if (cap) v.capacity = cap;
    const levels = num(t['building:levels'] || t.levels);
    if (levels) v.levels = levels;
    if (t.access && t.access !== 'yes') v.access = t.access;
    if (t.operator) v.operator = t.operator;
    if (t.opening_hours) v.hours = t.opening_hours;
    if (t.covered === 'yes') v.covered = true;
    const ev = num(t['capacity:charging']);
    if (ev) v.ev = ev;
    const rate = kind === 'mall' ? null : parseOsmRate(t);
    if (rate) v.rate = rate;
    out.push(v);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'th'));
}
