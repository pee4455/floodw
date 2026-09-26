// ข้อมูลบนแผนที่แบบไม่ผูกกับผู้ให้บริการแผนที่ — ใช้ร่วมกันระหว่าง Leaflet (OpenStreetMap) และ Google Maps
import { esc, safeUrl, depthLabel, fmtDateTime, timeAgo, searchKey } from './util.js';
import { hasLocation, canEmbed, thumbUrl, watchUrl, nearestCamera, STATE_LABEL } from './cams.js';

export const LAYER_KEYS = ['flood', 'watch', 'parking', 'news', 'cams', 'roads', 'js100'];

/** ชุดเลเยอร์ของแต่ละโหมด (ผู้ใช้ยังเปิด/ปิดเองได้หลังเลือกโหมด) */
export const MODES = {
  normal: { label: 'ปกติ', layers: { flood: 1, watch: 1, parking: 1, news: 1, cams: 1, roads: 0, js100: 0 }, radar: false, traffic: false },
  traffic: { label: 'จราจร', layers: { flood: 1, watch: 0, parking: 0, news: 0, cams: 1, roads: 1, js100: 1 }, radar: false, traffic: true },
  flood: { label: 'น้ำท่วม', layers: { flood: 1, watch: 1, parking: 1, news: 1, cams: 0, roads: 1, js100: 1 }, radar: true, traffic: false },
};

export function depthColor(depthCm) {
  const d = depthCm ? Math.max(...depthCm) : 0;
  if (d >= 20) return '#dc2626';
  if (d >= 10) return '#f97316';
  return '#eab308';
}

export const ROAD_COLORS = { avoid: '#dc2626', caution: '#f97316' };

const srcLink = (s) => (s && safeUrl(s.url) ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title || 'แหล่งข่าว')}</a>` : '');

const BMA_CCTV = 'https://cpudapp.bangkok.go.th/bmatraffic/';
const DDS_CCTV = 'https://dds.bangkok.go.th/cctv.php';

/** ลิงก์กล้องใกล้จุดน้ำท่วม: กล้องที่ใกล้ที่สุด (≤3 กม.) + กล้องทางการของ กทม. */
function nearbyCamHtml(cams, point) {
  const near = nearestCamera(cams, point, 3);
  const nearHtml = near ? `<button type="button" data-cam-play="${esc(near.cam.id)}">📷 ดูกล้องใกล้ๆ (${near.d.toFixed(1)} กม.)</button><br>` : '';
  return `<br>${nearHtml}<span class="tiny">กล้อง กทม.: <a href="${DDS_CCTV}" target="_blank" rel="noopener">ระดับน้ำ</a> · <a href="${BMA_CCTV}" target="_blank" rel="noopener">จราจร</a></span>`;
}

/** ลิงก์เปิด Google Maps ที่พิกัด พร้อมชั้นข้อมูลการจราจร */
export const googleTrafficUrl = (lat, lon, zoom = 14) => `https://www.google.com/maps/@${lat},${lon},${zoom}z/data=!5m1!1e1`;

/** รวมรายการตามสถานที่ ไม่ให้หมุดซ้อนกัน */
function groupByPlace(items) {
  const byPlace = new Map();
  for (const it of items) {
    for (const pl of it.places || []) {
      const cur = byPlace.get(pl.name) || { place: pl, items: [] };
      cur.items.push(it);
      byPlace.set(pl.name, cur);
    }
  }
  return [...byPlace.values()];
}

/**
 * แปลงข้อมูลทั้งหมดเป็นรายการ feature ที่เครื่องมือแผนที่วาดได้ทันที
 * feature: { layer, type:'circle'|'html'|'line', lat, lon, path, color, radius, html, size, title, popup:()=>string }
 */
export function buildFeatures({ curated, news, cams = [], floodRoads, js100, now = Date.now() }) {
  const out = [];

  for (const p of curated?.floodPoints || []) {
    if (p.status === 'cleared') continue;
    out.push({
      layer: 'flood',
      type: 'circle',
      lat: p.lat,
      lon: p.lon,
      color: depthColor(p.depthCm),
      radius: 10,
      title: p.name,
      popup: () =>
        `<b>${esc(p.name)}</b><br>${p.district ? `เขต/พื้นที่: ${esc(p.district)}<br>` : ''}` +
        `ระดับน้ำ: <b>${esc(depthLabel(p.depthCm))}</b><br>${esc(p.note || '')}<br>` +
        `<span class="tiny">รายงาน: ${esc(fmtDateTime(p.reportedAt))}${p.approximate ? ' · ตำแหน่งโดยประมาณ' : ''}</span><br>${srcLink(p.source)}` +
        nearbyCamHtml(cams, p),
    });
  }

  for (const w of curated?.watchPoints || []) {
    out.push({
      layer: 'watch',
      type: 'circle',
      lat: w.lat,
      lon: w.lon,
      color: '#2563eb',
      radius: 9,
      title: w.name,
      popup: () => `<b>${esc(w.name)}</b><br>สถานะ: <b>${esc(w.level || '-')}</b><br>${esc(w.note || '')}<br>${srcLink(w.source)}`,
    });
  }

  for (const p of curated?.parking || []) {
    out.push({
      layer: 'parking',
      type: 'html',
      lat: p.lat,
      lon: p.lon,
      html: '<span class="parking-pin">P</span>',
      size: 22,
      title: p.name,
      popup: () =>
        `<b>${esc(p.name)}</b><br>${esc(p.area || '')}<br>${esc(p.floors || '')}` +
        `${p.capacity ? ` · ${esc(p.capacity.toLocaleString('th-TH'))} คัน` : ''}<br>` +
        `${esc(p.from || '')} ถึง ${esc(p.until || '')}<br>${esc(p.conditions || '')}<br>` +
        `<a href="https://www.google.com/maps/dir/?api=1&destination=${+p.lat},${+p.lon}" target="_blank" rel="noopener">นำทาง</a> · ${srcLink(p.source)}`,
    });
  }

  for (const { place, items } of groupByPlace(news?.items || [])) {
    const list = items
      .slice(0, 6)
      .map((n) => `<li><a href="${esc(safeUrl(n.link) || '#')}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`)
      .join('');
    out.push({
      layer: 'news',
      type: 'circle',
      lat: place.lat,
      lon: place.lon,
      color: '#64748b',
      radius: Math.min(6 + items.length, 14),
      title: place.name,
      popup: () => `<b>${esc(place.name)}</b> <span class="tiny">(${items.length} ข่าว · ตำแหน่งโดยประมาณ)</span><ul>${list}</ul>`,
    });
  }

  for (const c of cams) {
    if (!hasLocation(c)) continue;
    const kind = c.type === 'snapshot' ? ' traffic' : c.state === 'live' ? ' live' : '';
    const link = watchUrl(c);
    out.push({
      layer: 'cams',
      type: 'html',
      lat: c.lat,
      lon: c.lon,
      html: `<span class="cam-marker${kind}"></span>`,
      size: c.type === 'snapshot' ? 20 : 26,
      title: c.name,
      popup: () =>
        `<b>📷 ${esc(c.name)}</b><br><span class="tiny">${esc(c.area || '')} · ${esc(STATE_LABEL[c.state] || '')}</span>` +
        (c.videoId ? `<img class="popup-cam" src="${esc(thumbUrl(c.videoId))}" alt="" loading="lazy">` : '<br>') +
        (canEmbed(c) ? `<button type="button" data-cam-play="${esc(c.id)}">▶ ดูสด</button> ` : '') +
        (link && c.type === 'youtube' ? `<a href="${esc(link)}" target="_blank" rel="noopener">เปิดใน YouTube</a>` : '') +
        (c.note ? `<br><span class="tiny">${esc(c.note)}</span>` : ''),
    });
  }

  for (const r of floodRoads?.roads || []) {
    if (!Array.isArray(r.path) || r.path.length < 2) continue;
    const mid = r.path[Math.floor(r.path.length / 2)];
    out.push({
      layer: 'roads',
      type: 'line',
      path: r.path,
      lat: mid[0],
      lon: mid[1],
      color: ROAD_COLORS[r.level] || ROAD_COLORS.caution,
      dashed: r.level !== 'avoid',
      title: r.name,
      id: `road:${r.name}`,
      popup: () =>
        `<b>${r.level === 'avoid' ? '⛔ หลีกเลี่ยง' : '⚠️ ขับช้า ระวัง'}: ${esc(r.name)}</b><br>${esc(r.section || '')}` +
        `<br><span class="tiny">เขต ${esc(r.districts || '-')}</span>` +
        `${r.delayMin ? `<br>ช้ากว่าปกติ ~${esc(r.delayMin)} นาที` : ''}${r.note ? ` · ${esc(r.note)}` : ''}` +
        `<br><span class="tiny">ข้อมูล ณ ${esc(fmtDateTime(floodRoads.observedAt))} (${esc(timeAgo(floodRoads.observedAt, now))}) · อนุมานจากสีจราจร Google Maps</span>` +
        `<br><a href="${esc(googleTrafficUrl(mid[0], mid[1]))}" target="_blank" rel="noopener">เปิด Google Maps ดูจราจรตอนนี้</a>`,
    });
  }

  const js100Items = [...(js100?.traffic || []).map((t) => ({ ...t, title: t.text, kind: 'traffic' })), ...(js100?.news || []).map((n) => ({ ...n, kind: 'news' }))];
  for (const { place, items } of groupByPlace(js100Items)) {
    const flood = items.some((i) => i.categories?.includes('flood'));
    const list = items
      .slice(0, 6)
      .map((i) => {
        const when = i.published ? `<span class="tiny">${esc(fmtDateTime(i.published))}</span> ` : '';
        const link = safeUrl(i.link);
        return `<li>${when}${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(i.title)}</a>` : esc(i.title)}</li>`;
      })
      .join('');
    out.push({
      layer: 'js100',
      type: 'html',
      lat: place.lat,
      lon: place.lon,
      html: `<span class="js100-pin${flood ? ' flood' : ''}">จส</span>`,
      size: 24,
      title: place.name,
      popup: () =>
        `<b>จส.100 · ${esc(place.name)}</b> <span class="tiny">(${items.length} รายการ · ตำแหน่งโดยประมาณ)</span><ul>${list}</ul>` +
        `<span class="tiny"><a href="https://www.js100.com/en/site/traffic" target="_blank" rel="noopener">js100.com</a></span>`,
    });
  }

  return out;
}

/** จุดที่ใช้ซูมแผนที่ครั้งแรก: จุดน้ำท่วม/เฝ้าระวัง/ที่จอดรถ (ไม่ดึงไปไกลถึงต่างจังหวัด) */
export function fitPoints(curated) {
  return [...(curated?.floodPoints || []), ...(curated?.watchPoints || []), ...(curated?.parking || [])]
    .filter((p) => p.inBangkok !== false || p.lat < 14.2)
    .map((p) => [p.lat, p.lon]);
}

// ---------- รายการในแผงโหมดจราจร/น้ำท่วม ----------
const JS100_KINDS = {
  flood: /น้ำท่วม|น้ำขัง|ท่วมขัง|ระดับน้ำ/,
  accident: /อุบัติเหตุ|ชนกัน|พลิก|จอดเสีย|เสียหลัก|ไฟไหม้|เพลิงไหม้|ลัดวงจร|ตกหล่น/,
  jam: /ติดขัด|เคลื่อนตัวช้า|หยุดนิ่ง|ปิดการจราจร|ปิดเบี่ยง|ปิดถนน|ปิดช่องจราจร|ปิด\s?\d+\s?ช่อง/,
};

/** ประเภทรายงาน จส.100: flood / accident / jam (อาจเป็นได้หลายแบบ) */
export function js100Kinds(item) {
  const text = item.text || item.title || '';
  const out = Object.keys(JS100_KINDS).filter((k) => JS100_KINDS[k].test(text));
  if (item.categories?.includes('flood') && !out.includes('flood')) out.unshift('flood');
  return out;
}

export function filterJs100(items, { q = '', kind = '' } = {}) {
  const key = searchKey(q);
  return (items || []).filter((i) => {
    if (kind && !js100Kinds(i).includes(kind)) return false;
    if (!key) return true;
    return searchKey([i.text || i.title, ...(i.places || []).map((p) => p.name)].join(' ')).includes(key);
  });
}

/** ถนนน้ำท่วม: กรองตามคำค้น/โซน แล้วเรียง "ควรเลี่ยง" ก่อน ตามด้วยช้ามากก่อน */
export function filterRoads(roads, { q = '', zone = '' } = {}) {
  const key = searchKey(q);
  return (roads || [])
    .filter((r) => (!zone || r.zone === zone) && (!key || searchKey([r.name, r.section, r.districts, r.note, r.zone].join(' ')).includes(key)))
    .sort((a, b) => (a.level === 'avoid' ? 0 : 1) - (b.level === 'avoid' ? 0 : 1) || (b.delayMin || 0) - (a.delayMin || 0));
}
