import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItic, looksLikeImage } from '../scripts/lib/itic.mjs';

// ตัวอย่างรูปแบบเดียวกับฟีดจริง https://camera.longdo.com/feed/?command=json
const feed = [
  {
    title: '(จ.นนทบุรี) 302 - อ.เมืองนนทบุรี  ทิศทางมุ่งหน้าเข้า กทม.',
    camid: 'DOH-PER-9-026',
    latitude: '13.87167',
    longitude: '100.462385',
    organization: 'กรมทางหลวง',
    vdourl: 'https://camera1.iticfoundation.org/mjpeg.php?camid=PER-9-026',
    imgurl: 'https://camera1.iticfoundation.org/jpeg.cgi?camid=PER-9-026',
    hls_url: 'https://camerai1.iticfoundation.org/pass/1.2.3.4:1935/Phase9/PER_9_026_IN.stream/playlist.m3u8',
  },
  { title: 'ตรัง', camid: 'DOH-PER-8-027', latitude: '7.55', longitude: '99.71', imgurl: 'https://camera1.iticfoundation.org/jpeg.cgi?camid=x' },
  { title: 'placeholder', camid: 'ITICM_1', latitude: '13.75', longitude: '100.5', imgurl: 'https://camera1.iticfoundation.org/jpeg2.php?camid=X.X.X.X:YYYY' },
  { title: 'http only', camid: 'A', latitude: '13.75', longitude: '100.5', imgurl: 'http://cameras.iticfoundation.org/api/jpeg2.php?camid=1' },
  { title: 'no coords', camid: 'B', latitude: '', longitude: '', imgurl: 'https://camera1.iticfoundation.org/jpeg.cgi?camid=B' },
  { title: 'dup', camid: 'DOH-PER-9-026', latitude: '13.8', longitude: '100.4', imgurl: 'https://camera1.iticfoundation.org/jpeg.cgi?camid=Z' },
  { title: 'suspended hls', camid: 'C', latitude: '13.7', longitude: '100.6', imgurl: 'https://camera1.iticfoundation.org/jpeg.cgi?camid=C', hls_url: 'https://camerai1.iticfoundation.org/hls/tempsus.m3u8' },
];

test('normalizeItic keeps only Bangkok-area https cameras with real ids', () => {
  const r = normalizeItic(feed);
  assert.deepEqual(r.map((c) => c.id), ['itic-DOH-PER-9-026', 'itic-C']);
  const c = r[0];
  assert.equal(c.type, 'snapshot');
  assert.equal(c.name, '(จ.นนทบุรี) 302 - อ.เมืองนนทบุรี ทิศทางมุ่งหน้าเข้า กทม.');
  assert.equal(c.org, 'กรมทางหลวง');
  assert.equal(c.lat, 13.87167);
  assert.match(c.hls, /playlist\.m3u8$/);
  assert.equal(r[1].hls, null, 'suspended stream dropped');
});

test('normalizeItic tolerates garbage input', () => {
  assert.deepEqual(normalizeItic(null), []);
  assert.deepEqual(normalizeItic([null, 1, 'x']), []);
});

test('looksLikeImage', () => {
  assert.equal(looksLikeImage('image/jpeg', 30000), true);
  assert.equal(looksLikeImage('image/jpeg', 500), false);
  assert.equal(looksLikeImage('text/html', 30000), false);
});

test('parsePlaylist: media, master (relative variant) and junk', async () => {
  const { parsePlaylist } = await import('../scripts/lib/itic.mjs');
  assert.deepEqual(parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nseg1.ts\n', 'https://h/a/p.m3u8'), { ok: true, variant: null });
  assert.deepEqual(parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nchunklist_w1.m3u8\n', 'https://h/a/playlist.m3u8'), {
    ok: true,
    variant: 'https://h/a/chunklist_w1.m3u8',
  });
  assert.equal(parsePlaylist('#EXTM3U\n', 'https://h/').ok, false, 'empty playlist = camera offline');
  assert.equal(parsePlaylist('<html>error</html>', 'https://h/').ok, false);
});

test('highwaytraffic parsers', async () => {
  const { parseSiteIds, parseSiteInfo, parseCameraInfo, dohCodeFromItic } = await import('../scripts/lib/doh.mjs');
  const home = `<a href='javascript:MoveLocation2(2753)'>PER-3-003</a> <a href='javascript:MoveLocation2(2767)'>PER-3-004</a><a href='javascript:MoveLocation2(2753)'>PER-3-003</a>`;
  assert.deepEqual(parseSiteIds(home), [{ id: 2753, code: 'PER-3-003' }, { id: 2767, code: 'PER-3-004' }]);
  const info = parseSiteInfo([
    '14.3914',
    '100.8880',
    'PER-3-003',
    "<table><tr><td nowrap><b>ชื่อจุดติดตั้ง</b></td><td nowrap>1 - อ.หนองแค จ.สระบุรี</td></tr><tr><td nowrap><b>รายละเอียด</b></td><td>ทางหลวงหมายเลข 1 กม.92-93 </td></tr></table>",
  ]);
  assert.deepEqual(info, { lat: 14.3914, lon: 100.888, code: 'PER-3-003', name: '1 - อ.หนองแค จ.สระบุรี', detail: 'ทางหลวงหมายเลข 1 กม.92-93' });
  assert.equal(parseSiteInfo(['0', '0', 'X']), null);
  const cam = `<div id="ctl01_playerElement01" style="x" wowza_auto_refresh="Y" site_code="https://streaming1.highwaytraffic.go.th/Phase3/PER_3_003_IN.stream/playlist.m3u8" site_code_text="PER-3-003"></div>
    <span id="ctl01_TxtDirectIn">ทิศทางมุ่งหน้ากรุงเทพ</span>
    <div id="ctl01_playerElement02" style="x" wowza_auto_refresh="Y" site_code="https://streaming1.highwaytraffic.go.th/Phase3/PER_3_003_OUT.stream/playlist.m3u8"></div>
    <span id="ctl01_TxtDirectOut">ทิศทางออกจากกรุงเทพ</span>`;
  assert.deepEqual(parseCameraInfo(cam), [
    { label: 'ทิศทางมุ่งหน้ากรุงเทพ', hls: 'https://streaming1.highwaytraffic.go.th/Phase3/PER_3_003_IN.stream/playlist.m3u8' },
    { label: 'ทิศทางออกจากกรุงเทพ', hls: 'https://streaming1.highwaytraffic.go.th/Phase3/PER_3_003_OUT.stream/playlist.m3u8' },
  ]);
  assert.equal(dohCodeFromItic('DOH-PER-3-006-out'), 'PER-3-006');
  assert.equal(dohCodeFromItic('ITICM_BMAMI0125'), null);
});
