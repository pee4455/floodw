// ชั่วคราว: ดึงข้อความจากข่าวที่จอดรถ (เครื่องพัฒนาเข้าเว็บข่าวไทยไม่ได้)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const urls = process.argv.slice(2);
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
const queries = ['จอดรถ น้ำท่วม ฟรี', 'เปิดพื้นที่จอดรถ น้ำท่วม', 'จอดรถหนีน้ำ', 'ที่จอดรถ ผู้ประสบภัย น้ำท่วม กทม', 'แฟชั่นไอส์แลนด์ จอดรถ', 'สายสีชมพู จอดรถ น้ำท่วม', 'จอดรถฟรี ห้าง น้ำท่วม รามอินทรา', 'อาคารจอดแล้วจร น้ำท่วม'];
for (const q of queries) {
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:3d')}&hl=th&gl=TH&ceid=TH:th`, { headers: { 'user-agent': UA } });
    const x = await r.text();
    console.log(`\n### RSS ${q}`);
    for (const m of x.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)) console.log('-', m[2].slice(5, 22), m[1].replace(/<!\[CDATA\[|\]\]>/g, ''));
  } catch (e) { console.log('RSS fail', q, e.message); }
}
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'th' }, redirect: 'follow' });
    const t = strip(await r.text());
    const i = Math.max(0, t.search(/จอด/) - 1500);
    console.log(`\n### PAGE ${u} (${r.status})\n${t.slice(i, i + 7000)}`);
  } catch (e) { console.log('PAGE fail', u, e.message); }
}
