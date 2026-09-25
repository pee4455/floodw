import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRss, categorize, extractDepthCm, dedupe, enrich, decodeEntities } from '../scripts/lib/news.mjs';
import { findPlaces } from '../public/js/gazetteer.js';

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>ฝนถล่ม กทม. น้ำท่วมขัง ถ.ลาดกระบัง แยกกิ่งแก้ว สูง 15-20 ซม. - กรุงเทพธุรกิจ</title>
<link>https://example.com/a</link><pubDate>Fri, 25 Sep 2026 01:00:00 GMT</pubDate>
<description>&lt;a href="x"&gt;ข่าว&lt;/a&gt;</description><source url="https://bkb">กรุงเทพธุรกิจ</source></item>
<item><title><![CDATA[วัดพระธรรมกาย เปิดอาคารจอดรถหนีน้ำ 1,000 คัน & ฟรี]]></title>
<link>https://example.com/b</link><pubDate>bad date</pubDate></item>
</channel></rss>`;

test('parseRss strips Google News source suffix, decodes CDATA/entities', () => {
  const items = parseRss(RSS);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'ฝนถล่ม กทม. น้ำท่วมขัง ถ.ลาดกระบัง แยกกิ่งแก้ว สูง 15-20 ซม.');
  assert.equal(items[0].source, 'กรุงเทพธุรกิจ');
  assert.equal(items[0].published, '2026-09-25T01:00:00.000Z');
  assert.equal(items[0].summary, 'ข่าว');
  assert.equal(items[1].title, 'วัดพระธรรมกาย เปิดอาคารจอดรถหนีน้ำ 1,000 คัน & ฟรี');
  assert.equal(items[1].published, null);
});

test('decodeEntities handles numeric entities', () => {
  assert.equal(decodeEntities('&#3609;&#x0E49;&amp;'), 'น้&');
});

test('categorize', () => {
  assert.deepEqual(categorize('เปิดอาคารจอดรถหนีน้ำท่วม'), ['parking', 'flood']);
  assert.deepEqual(categorize('กทม. เตือนระดับน้ำเจ้าพระยาสูงขึ้น'), ['river', 'weather']);
  assert.deepEqual(categorize('รถติดหนักถนนพระราม 9'), ['traffic']);
});

test('extractDepthCm', () => {
  assert.deepEqual(extractDepthCm('น้ำท่วมสูง 15-20 ซม.'), [15, 20]);
  assert.deepEqual(extractDepthCm('ระดับน้ำ 10 – 15 เซนติเมตร'), [10, 15]);
  assert.deepEqual(extractDepthCm('น้ำสูง 30 ซม.'), [30, 30]);
  assert.equal(extractDepthCm('ฝน 101.5 มม.'), null);
});

test('findPlaces prefers roads and avoids double counting', () => {
  const names = (t) => findPlaces(t).map((p) => p.name);
  assert.deepEqual(names('น้ำท่วม ถ.วิภาวดีรังสิต ขาเข้า'), ['ถ.วิภาวดีรังสิต']);
  assert.deepEqual(names('ถนนลาดพร้าว น้ำท่วม'), ['ถ.ลาดพร้าว']);
  assert.deepEqual(names('ฝนตกหนักเขตบางเขน และดอนเมือง'), ['บางเขน', 'ดอนเมือง']);
  assert.deepEqual(names('ฟิวเจอร์พาร์ครังสิต'), ['รังสิต']);
  assert.deepEqual(names('ข่าวทั่วไป'), []);
});

test('dedupe keeps newest, drops same title with different suffix punctuation', () => {
  const out = dedupe([
    { title: 'น้ำท่วม กทม. 25 ก.ย.', link: 'a', published: '2026-09-25T01:00:00Z' },
    { title: 'น้ำท่วม กทม. 25 ก.ย. !', link: 'b', published: '2026-09-25T02:00:00Z' },
    { title: 'อีกข่าว', link: 'c', published: null },
  ]);
  assert.deepEqual(out.map((o) => o.link), ['b', 'c']);
});

test('enrich adds categories, depth, places and bangkok flag', () => {
  const e = enrich({ title: 'กทม. น้ำท่วมขังแยกกิ่งแก้ว 15-20 ซม.', summary: '' });
  assert.ok(e.categories.includes('flood'));
  assert.deepEqual(e.depthCm, [15, 20]);
  assert.equal(e.places[0].name, 'แยกกิ่งแก้ว-ลาดกระบัง');
  assert.equal(e.bangkok, true);
});
