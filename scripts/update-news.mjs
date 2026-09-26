#!/usr/bin/env node
// ดึงข่าวน้ำท่วม/สภาพอากาศกรุงเทพฯ จาก RSS แล้วเขียน public/data/news.json
// รันอัตโนมัติทุก 30 นาทีผ่าน GitHub Actions (.github/workflows/update-data.yml)
// รันเอง: npm run update-news
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseRss, enrich, dedupe, isRelevant } from './lib/news.mjs';
import { JS100, parseTraffic, parseNewsList, enrichJs100 } from './lib/js100.mjs';

const OUT = fileURLToPath(new URL('../public/data/news.json', import.meta.url));
const OUT_JS100 = fileURLToPath(new URL('../public/data/js100.json', import.meta.url));
const MAX_AGE_DAYS = 7;
const MAX_ITEMS = 200;

const gnews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:3d`)}&hl=th&gl=TH&ceid=TH:th`;

/** แหล่งข่าว — เพิ่ม/ลดได้ แต่ละแหล่งล้มเหลวได้โดยไม่กระทบแหล่งอื่น */
export const FEEDS = [
  { name: 'Google News: น้ำท่วมกรุงเทพ', url: gnews('น้ำท่วม กรุงเทพ') },
  { name: 'Google News: น้ำท่วมขัง กทม.', url: gnews('น้ำท่วมขัง กทม.') },
  { name: 'Google News: จอดรถหนีน้ำ', url: gnews('จอดรถหนีน้ำ') },
  { name: 'Google News: ที่จอดรถฟรี น้ำท่วม', url: gnews('เปิดพื้นที่จอดรถ น้ำท่วม') },
  { name: 'Google News: ระดับน้ำเจ้าพระยา', url: gnews('ระดับน้ำ เจ้าพระยา กทม.') },
  { name: 'Google News: เตือนฝนตกหนัก', url: gnews('กรมอุตุ เตือน ฝนตกหนัก กรุงเทพ') },
  { name: 'Google News: ศูนย์พักพิง/ช่วยเหลือ', url: gnews('ศูนย์พักพิง น้ำท่วม กทม.') },
  { name: 'Google News (EN): Bangkok flood', url: 'https://news.google.com/rss/search?q=Bangkok+flood+when:3d&hl=en-TH&gl=TH&ceid=TH:en' },
];

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; BangkokFloodWatch/1.0; +https://github.com/pee4455/floodw)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * จส.100: รายงานจราจรล่าสุด + ข่าว → public/data/js100.json
 * คืนข่าวที่เกี่ยวกับน้ำ/ฝน เพื่อรวมเข้าหน้าข่าวหลักด้วย
 */
async function updateJs100() {
  const post = (offset) =>
    fetch(JS100.more, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (compatible; BangkokFloodWatch/1.0)' },
      body: `per_page=12&offset=${offset}`,
      signal: AbortSignal.timeout(20000),
    }).then((r) => (r.ok ? r.text() : ''));
  const [trafficHtml, newsHtml, more1, more2] = await Promise.all([
    fetchText(JS100.traffic),
    fetchText(JS100.news),
    post(1).catch(() => ''),
    post(2).catch(() => ''),
  ]);
  const traffic = parseTraffic(trafficHtml).map((t, i) => ({ id: `t${i}-${t.published}`, ...t, ...enrichJs100(t.text) }));
  const news = parseNewsList(`${newsHtml}${more1}${more2}`).map((n) => ({ ...n, ...enrichJs100(n.title) }));
  if (!traffic.length && !news.length) throw new Error('จส.100: ไม่พบรายการ (หน้าเว็บอาจเปลี่ยนรูปแบบ)');
  await writeFile(
    OUT_JS100,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), source: 'จส.100 (js100.com)', traffic, news }, null, 1)}\n`,
  );
  console.log(`จส.100: รายงานจราจร ${traffic.length} รายการ ข่าว ${news.length} รายการ → ${OUT_JS100}`);
  return news
    .filter((n) => isRelevant(n.title))
    .map((n) => ({ title: n.title, link: n.link, published: n.published, source: 'จส.100', summary: '', feed: 'จส.100' }));
}

async function main() {
  const js100 = updateJs100().catch((e) => {
    console.error('จส.100 ล้มเหลว:', e.message);
    return null;
  });
  const results = await Promise.allSettled(FEEDS.map((f) => fetchText(f.url)));
  const status = [];
  let items = [];
  results.forEach((r, i) => {
    const feed = FEEDS[i];
    if (r.status === 'fulfilled') {
      const parsed = parseRss(r.value);
      status.push({ feed: feed.name, ok: true, count: parsed.length });
      items.push(...parsed.map((it) => ({ ...it, feed: feed.name })));
    } else {
      status.push({ feed: feed.name, ok: false, error: String(r.reason?.message || r.reason) });
    }
  });

  const js100News = await js100;
  status.push(js100News ? { feed: 'จส.100', ok: true, count: js100News.length } : { feed: 'จส.100', ok: false });
  items.push(...(js100News || []));

  // เก็บข่าวเก่าที่ยังไม่หมดอายุไว้ด้วย เผื่อรอบนี้บางแหล่งล้ม
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    items.push(...(prev.items || []));
  } catch {
    /* ไม่มีไฟล์เดิม */
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400e3;
  items = dedupe(items)
    .filter((it) => it.title && it.link)
    .filter((it) => !it.published || new Date(it.published).getTime() >= cutoff)
    .map((it) => enrich(it))
    .filter((it) => isRelevant(`${it.title} ${it.summary}`))
    .slice(0, MAX_ITEMS);

  const okFeeds = status.filter((s) => s.ok).length;
  if (okFeeds === 0) {
    console.error('ดึงข่าวไม่ได้เลยสักแหล่ง — ไม่เขียนทับไฟล์เดิม');
    console.error(status);
    process.exitCode = 1;
    return;
  }

  const out = { generatedAt: new Date().toISOString(), feeds: status, items };
  await writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`เขียน ${items.length} ข่าว (${okFeeds}/${FEEDS.length} แหล่งสำเร็จ) → ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
