// ชั่วคราว: หารายละเอียดข่าวที่จอดรถ
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/li>|<\/h\d>|<\/div>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
const get = async (u) => { const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-language': 'th' } }); return { status: r.status, html: await r.text() }; };
// Thai PBS: ไล่เลขข่าวช่วง 25-26 ก.ย.
for (let id = 558520; id <= 558610; id++) {
  try {
    const { status, html } = await get(`https://www.thaipbs.or.th/news/content/${id}`);
    const t = (html.match(/<title>([^<]*)/) || [])[1] || '';
    if (/จอด/.test(t)) { const s = strip(html); const i = Math.max(0, s.indexOf('จอด') - 800); console.log(`\n### TPBS ${id} ${t}\n${s.slice(i, i + 6000)}`); }
    else if (status === 200) console.log('tpbs', id, t.slice(0, 80));
  } catch {}
}
for (const u of process.argv.slice(2)) {
  try {
    const { status, html } = await get(u);
    const s = strip(html); const i = Math.max(0, s.indexOf('จอด') - 800);
    console.log(`\n### PAGE ${u} (${status})\n${s.slice(i, i + 6000)}`);
  } catch (e) { console.log('fail', u, e.message); }
}
