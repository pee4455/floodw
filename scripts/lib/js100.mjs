// ข่าวและรายงานจราจรจาก จส.100 (js100.com) — หน้าเว็บสาธารณะ ไม่มี RSS จึงแยกจาก HTML
import { decodeEntities, categorize, extractDepthCm } from './news.mjs';
import { findPlaces } from '../../public/js/gazetteer.js';

export const JS100 = {
  traffic: 'https://www.js100.com/en/site/traffic',
  news: 'https://www.js100.com/en/site/news',
  more: 'https://www.js100.com/en/site/news/detail_more',
};

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** "25  กันยายน 2569,   14:12น." → "2026-09-25T07:12:00.000Z" (เวลาไทย, พ.ศ.) */
export function parseThaiDate(s) {
  const m = String(s || '').match(/(\d{1,2})\s+([ก-๙]+)\s+(\d{4}),?\s+(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const month = TH_MONTHS.indexOf(m[2]);
  if (month < 0) return null;
  const year = Number(m[3]) - 543;
  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:00+07:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const clean = (s) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** รายงานสภาพจราจรล่าสุด: <li><h4>วันที่</h4><p>ข้อความ</p></li> */
export function parseTraffic(html) {
  const list = String(html).match(/id="latest_traffic_list"[\s\S]*?<\/ul>/);
  if (!list) return [];
  const out = [];
  for (const m of list[0].matchAll(/<li>\s*<h4>([\s\S]*?)<\/h4>\s*<p>([\s\S]*?)<\/p>/g)) {
    const text = clean(m[2]);
    if (text) out.push({ text, published: parseThaiDate(clean(m[1])) });
  }
  return out;
}

/** รายการข่าว (หน้า news และ detail_more): หัวข้อ ลิงก์ วันที่ แท็ก */
export function parseNewsList(html) {
  const s = String(html);
  const out = new Map();
  const re = /<a href="(https:\/\/www\.js100\.com\/en\/site\/news\/view\/(\d+))"[^>]*>([^<]{6,})<\/a>/g;
  for (const m of s.matchAll(re)) {
    const title = clean(m[3]);
    if (!title || title === 'อ่านต่อ' || out.has(m[2])) continue;
    const after = s.slice(m.index, m.index + 2500);
    const date = after.match(/class="news_date">([\s\S]*?)<\/h4>/);
    const tagBox = after.match(/news_tag_container">([\s\S]*?)<\/div>/);
    const tags = tagBox ? [...tagBox[1].matchAll(/>([^<]+)<\/a>/g)].map((t) => clean(t[1])) : [];
    out.set(m[2], { id: m[2], title, link: m[1], published: date ? parseThaiDate(clean(date[1])) : null, tags });
  }
  return [...out.values()];
}

/** เติมหมวด/ตำแหน่ง/ความลึกน้ำ ให้รายงานจราจรหรือข่าว */
// รายงานที่อยู่นอกกรุงเทพฯ/ปริมณฑลชัดเจน (มอเตอร์เวย์ระบุ กม. ไกลๆ, ต่างจังหวัด) ไม่ปักหมุด
const OUTSIDE = /พัทยา|ชลบุรี|ระยอง|อยุธยา|บางปะอิน|มหาชัย|กม\.\s?\d{2,}/;

/**
 * เลือกตำแหน่งหลักเพียงจุดเดียวของรายงาน: "เขตXXX" ที่ระบุตรงๆ ก่อน ไม่งั้นชื่อที่ปรากฏก่อนในข้อความ
 * (รายงาน จส.100 ขึ้นต้นด้วยถนนที่เกิดเหตุ ส่วนชื่อหลังๆ มักเป็นจุดอ้างอิง/ปลายทาง)
 */
export function mainPlace(text) {
  if (!text || OUTSIDE.test(text)) return [];
  const places = findPlaces(text);
  const district = places.find((p) => p.kind === 'district' && text.includes(`เขต${p.name}`));
  if (district) return [district];
  const pos = (p) => {
    const keys = [p.name, p.name.replace(/^ถ\./, 'ถนน'), ...(p.match || [])];
    const idx = keys.map((k) => text.indexOf(k)).filter((i) => i >= 0);
    return idx.length ? Math.min(...idx) : Infinity;
  };
  const best = places.map((p) => ({ p, i: pos(p) })).sort((a, b) => a.i - b.i)[0];
  return best ? [best.p] : [];
}

export function enrichJs100(text) {
  return {
    categories: categorize(text),
    depthCm: extractDepthCm(text),
    places: mainPlace(text).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, kind: p.kind })),
  };
}
