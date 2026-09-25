// แยก RSS, จัดหมวดข่าว, ดึงระดับน้ำ และจับตำแหน่งจากข่าว (ไม่มี dependency ภายนอก)
import { findPlaces } from '../../public/js/gazetteer.js';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * แยก RSS 2.0 (รวม Google News RSS)
 * @returns {{title:string, link:string, published:string|null, source:string, summary:string}[]}
 */
export function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    let title = stripTags(tag(block, 'title'));
    let source = stripTags(tag(block, 'source'));
    // Google News ใส่ " - ชื่อสำนักข่าว" ท้ายหัวข้อ
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const pub = tag(block, 'pubDate');
    const date = pub ? new Date(pub) : null;
    items.push({
      title,
      link: stripTags(tag(block, 'link')),
      published: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      source,
      summary: stripTags(tag(block, 'description')).slice(0, 300),
    });
  }
  return items;
}

/** หมวดข่าว: เรียงตามลำดับความสำคัญ (ข่าวหนึ่งมีได้หลายหมวด) */
export const CATEGORIES = [
  { key: 'parking', label: 'ที่จอดรถหนีน้ำ', re: /จอดรถ|ที่จอด|อาคารจอด|ลานจอด|จอดฟรี|ให้จอด|parking/i },
  { key: 'flood', label: 'จุดน้ำท่วม', re: /ท่วมขัง|น้ำท่วม|รอระบาย|น้ำขัง|ท่วมสูง|flood/i },
  { key: 'river', label: 'แม่น้ำ/เขื่อน', re: /เจ้าพระยา|เขื่อน|ลบ\.ม|ระดับน้ำ|น้ำเหนือ|น้ำทะเลหนุน|ประตูระบายน้ำ|Chao Phraya/i },
  { key: 'weather', label: 'พยากรณ์/เตือนภัย', re: /กรมอุตุ|พยากรณ์|เตือน|ฝนตกหนัก|ฝนถล่ม|มวลฝน|เรดาร์|กลุ่มเมฆ|พายุ|ดีเปรสชัน|ความกดอากาศต่ำ|มรสุม|storm|rain/i },
  { key: 'help', label: 'ความช่วยเหลือ', re: /ศูนย์พักพิง|อพยพ|ช่วยเหลือ|ถุงยังชีพ|กระสอบทราย|เยียวยา|บริจาค/i },
  { key: 'traffic', label: 'การจราจร', re: /รถติด|การจราจร|ปิดถนน|ปิดการจราจร|เลี่ยงเส้นทาง|traffic/i },
];

export function categorize(text) {
  return CATEGORIES.filter((c) => c.re.test(text)).map((c) => c.key);
}

/** ดึงความลึกน้ำจากข้อความ เช่น "15-20 ซม." "สูง 30 เซนติเมตร" → [15,20] / [30,30] */
export function extractDepthCm(text) {
  const range = text.match(/(\d{1,3})\s*(?:-|–|~|ถึง)\s*(\d{1,3})\s*(?:ซม|เซนติเมตร|cm)/i);
  if (range) return [Number(range[1]), Number(range[2])];
  const single = text.match(/(\d{1,3})\s*(?:ซม|เซนติเมตร|cm)/i);
  if (single) return [Number(single[1]), Number(single[1])];
  return null;
}

/** เกี่ยวกับกรุงเทพฯ/ปริมณฑลหรือไม่ */
export function isBangkokRelated(text, places) {
  if (/กรุงเทพ|กทม|คนกรุง|Bangkok|BMA|ปริมณฑล/i.test(text)) return true;
  return places.length > 0;
}

/** เกี่ยวกับน้ำ/ฝน/อากาศหรือไม่ (กรองข่าวที่หลุดมาจากคำค้น) */
export function isRelevant(text) {
  return /น้ำ|ฝน|ท่วม|พายุ|อุตุ|flood|rain|storm|จอดรถ/i.test(text);
}

const normTitle = (t) => t.replace(/[\s"'“”‘’!?.,:;()[\]|-]/g, '').toLowerCase();

/** รวมรายการ ตัดซ้ำตามหัวข้อ/ลิงก์ ใหม่สุดก่อน */
export function dedupe(items) {
  const seen = new Set();
  const out = [];
  const sorted = [...items].sort((a, b) => (b.published || '').localeCompare(a.published || ''));
  for (const it of sorted) {
    const k1 = normTitle(it.title).slice(0, 60);
    if (!k1 || seen.has(k1) || seen.has(it.link)) continue;
    seen.add(k1);
    seen.add(it.link);
    out.push(it);
  }
  return out;
}

/** เติมข้อมูลวิเคราะห์ให้ข่าวหนึ่งรายการ */
export function enrich(item) {
  const text = `${item.title} ${item.summary || ''}`;
  const places = findPlaces(text);
  return {
    ...item,
    categories: categorize(text),
    depthCm: extractDepthCm(text),
    places: places.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, kind: p.kind, outside: !!p.outside })),
    bangkok: isBangkokRelated(text, places),
  };
}
