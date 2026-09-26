// ชั่วคราว: ดึงข้อความจากข่าวที่จอดรถ (เครื่องพัฒนาเข้าเว็บข่าวไทยไม่ได้)
const UA0 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const UA = UA0;
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const urls = process.argv.slice(2);
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
const queries = ['แฟชั่นไอส์แลนด์', 'จอดรถ น้ำท่วม', 'จอดรถฟรี', 'ฝากรถ น้ำท่วม', 'เดอะมอลล์ จอดรถ', 'โลตัส จอดรถ น้ำท่วม', 'บิ๊กซี จอดรถ น้ำท่วม', 'อิมแพ็ค เมืองทอง จอดรถ', 'ทางด่วน จอดรถ น้ำท่วม', 'สะพาน จอดรถ น้ำท่วม กทม', 'เขต เปิด จอดรถ น้ำท่วม', 'มหาวิทยาลัย จอดรถ น้ำท่วม', 'โรงพยาบาล จอดรถ น้ำท่วม', 'จอดแล้วจร น้ำท่วม', 'ห้าง จอดรถ ผู้ประสบภัย'];
for (const q of queries) {
  try {
    const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:4d')}&hl=th&gl=TH&ceid=TH:th`, { headers: { 'user-agent': UA } });
    const x = await r.text();
    console.log(`\n### RSS ${q}`);
    for (const m of x.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)) { const t = m[1].replace(/<!\[CDATA\[|\]\]>/g, ''); if (/จอด|ฝากรถ/.test(t)) console.log('-', m[2].slice(5, 22), t); }
  } catch (e) { console.log('RSS fail', q, e.message); }
}
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': /thairath/.test(u) ? BOT : UA, 'accept-language': 'th' }, redirect: 'follow' });
    const t = strip(await r.text());
    const i = Math.max(0, t.search(/จอด/) - 1500);
    console.log(`\n### PAGE ${u} (${r.status})\n${t.slice(i, i + 7000)}`);
  } catch (e) { console.log('PAGE fail', u, e.message); }
}
