import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseThaiDate, parseTraffic, parseNewsList, enrichJs100 } from '../scripts/lib/js100.mjs';

test('parseThaiDate handles Buddhist year and Bangkok time', () => {
  assert.equal(parseThaiDate('25  กันยายน 2569,   14:12น.'), '2026-09-25T07:12:00.000Z');
  assert.equal(parseThaiDate('\t\t06  กันยายน 2565,   18:04น.\n'), '2022-09-06T11:04:00.000Z');
  assert.equal(parseThaiDate('ไม่ใช่วันที่'), null);
});

// ตัวอย่างจากหน้า https://www.js100.com/en/site/traffic
const TRAFFIC = `<ul id="latest_traffic_list">
  <li>
    <h4>25  กันยายน 2569,   14:12น.</h4>
<p>อุบัติเหตุ รถเก๋งชนคนข้ามถนน ถนนติวานนท์ (ถ.306) ขาออก จากห้าแยกปากเกร็ด</p>
  </li>
  <li>
    <h4>25  กันยายน 2569,   13:04น.</h4>
<p>น้ำท่วมขัง ถ.แจ้งวัฒนะ ขาออก สูง 20-30 ซม. &amp; รถติด</p>
  </li>
</ul>`;

test('parseTraffic', () => {
  const r = parseTraffic(TRAFFIC);
  assert.equal(r.length, 2);
  assert.equal(r[0].published, '2026-09-25T07:12:00.000Z');
  assert.match(r[1].text, /น้ำท่วมขัง ถ\.แจ้งวัฒนะ .* & รถติด/);
  assert.deepEqual(parseTraffic('<html></html>'), []);
});

// ตัวอย่างจากหน้า news และ detail_more
const NEWS = `<a href="https://www.js100.com/en/site/news/view/164707"><img src="x.jpg"></a>
<h1><a href="https://www.js100.com/en/site/news/view/164707">ปภ.แจ้งเตือนน้ำเหนือมีปริมาณเพิ่มขึ้น แม่น้ำท่าจีนเสี่ยงล้นตลิ่ง</a></h1>
<h4 class="news_date">
		25  กันยายน 2569,   13:16น.
		</h4>
<div class="news_tag_container">
<a href="https://www.js100.com/en/site/news/infilter/27">สังคม</a>
</div>
<a href="https://www.js100.com/en/site/news/view/164707" class="readmore_btn">อ่านต่อ</a>
<li><a href="https://www.js100.com/en/site/news/view/164690">กทม. เฝ้าระวังพื้นที่ ฝั่งตะวันออก-เร่งระบายน้ำคลองประเวศฯ</a>
<h4 class="news_date">25  กันยายน 2569,   10:46น.</h4>
<div class="news_tag_container"><a href="https://www.js100.com/en/site/news/infilter/27">สังคม</a><a href="https://www.js100.com/en/site/news/infilter/12">การเมือง</a></div></li>`;

test('parseNewsList dedupes by id and reads date/tags', () => {
  const r = parseNewsList(NEWS);
  assert.deepEqual(
    r.map((n) => [n.id, n.published, n.tags]),
    [
      ['164707', '2026-09-25T06:16:00.000Z', ['สังคม']],
      ['164690', '2026-09-25T03:46:00.000Z', ['สังคม', 'การเมือง']],
    ],
  );
  assert.equal(r[0].link, 'https://www.js100.com/en/site/news/view/164707');
});

test('enrichJs100 geotags and categorizes', () => {
  const e = enrichJs100('น้ำท่วมขัง ถ.แจ้งวัฒนะ ขาออก สูง 20-30 ซม. รถติด');
  assert.ok(e.categories.includes('flood') && e.categories.includes('traffic'));
  assert.deepEqual(e.depthCm, [20, 30]);
  assert.equal(e.places[0].name, 'ถ.แจ้งวัฒนะ');
});

test('enrichJs100 picks one main place and skips reports outside Bangkok', () => {
  const a = enrichJs100('อุบัติเหตุ ถนนติวานนท์ ขาออก จากห้าแยกปากเกร็ด มุ่งหน้าแยกสวนสมเด็จพระศรีนครินทร์');
  assert.deepEqual(a.places.map((p) => p.name), ['ปากเกร็ด']);
  const b = enrichJs100('โรงพยาบาลธนบุรี บำรุงเมือง ถนนบำรุงเมือง เขตป้อมปราบศัตรูพ่าย จะทำการซ้อมแผน');
  assert.deepEqual(b.places.map((p) => p.name), ['ป้อมปราบศัตรูพ่าย']);
  assert.equal(enrichJs100('น้ำท่วมขัง ถนนสุขุมวิท ขาเข้า ช่วงเลยอินเด็กซ์ ลิฟวิ่ง มอลล์ พัทยา').places.length, 0);
});
