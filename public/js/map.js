// แผนที่ Leaflet: จุดน้ำท่วม, จุดเฝ้าระวัง, ที่จอดรถ, ข่าวตามพื้นที่ และเรดาร์ฝน
import { esc, safeUrl, depthLabel, fmtDateTime } from './util.js';
import { fetchRadarFrames } from './api.js';

const L = window.L;

export function depthColor(depthCm) {
  const d = depthCm ? Math.max(...depthCm) : 0;
  if (d >= 20) return '#dc2626';
  if (d >= 10) return '#f97316';
  return '#eab308';
}

export function createMap(elId, center) {
  if (!L) return null;
  const map = L.map(elId, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lon], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const layers = {
    flood: L.layerGroup().addTo(map),
    watch: L.layerGroup().addTo(map),
    parking: L.layerGroup().addTo(map),
    news: L.layerGroup().addTo(map),
    radar: L.layerGroup(),
  };
  const locMarker = L.circleMarker([center.lat, center.lon], {
    radius: 6, color: '#0b6fc2', weight: 2, fillColor: '#fff', fillOpacity: 1,
  }).addTo(map).bindTooltip('จุดพยากรณ์');
  return { map, layers, locMarker, radar: { frames: [], idx: 0, timer: null, tiles: [] } };
}

const srcLink = (s) => (s && safeUrl(s.url) ? `<a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.title || 'แหล่งข่าว')}</a>` : '');

export function renderMapData(ctx, { curated, news }, { fit = false } = {}) {
  if (!ctx) return;
  const { layers } = ctx;
  Object.values(layers).forEach((g) => g !== layers.radar && g.clearLayers());

  for (const p of curated?.floodPoints || []) {
    if (p.status === 'cleared') continue;
    L.circleMarker([p.lat, p.lon], {
      radius: 10, color: '#fff', weight: 2, fillColor: depthColor(p.depthCm), fillOpacity: 0.9,
    })
      .bindPopup(
        `<b>${esc(p.name)}</b><br>${p.district ? `เขต/พื้นที่: ${esc(p.district)}<br>` : ''}` +
          `ระดับน้ำ: <b>${esc(depthLabel(p.depthCm))}</b><br>${esc(p.note || '')}<br>` +
          `<span class="tiny">รายงาน: ${esc(fmtDateTime(p.reportedAt))}${p.approximate ? ' · ตำแหน่งโดยประมาณ' : ''}</span><br>${srcLink(p.source)}`,
      )
      .addTo(layers.flood);
  }

  for (const w of curated?.watchPoints || []) {
    L.circleMarker([w.lat, w.lon], { radius: 9, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 0.9 })
      .bindPopup(`<b>${esc(w.name)}</b><br>สถานะ: <b>${esc(w.level || '-')}</b><br>${esc(w.note || '')}<br>${srcLink(w.source)}`)
      .addTo(layers.watch);
  }

  const pIcon = L.divIcon({ className: '', html: '<span class="parking-pin">P</span>', iconSize: [22, 22], iconAnchor: [11, 11] });
  for (const p of curated?.parking || []) {
    L.marker([p.lat, p.lon], { icon: pIcon, title: p.name })
      .bindPopup(
        `<b>${esc(p.name)}</b><br>${esc(p.area || '')}<br>${esc(p.floors || '')}` +
          `${p.capacity ? ` · ${esc(p.capacity.toLocaleString('th-TH'))} คัน` : ''}<br>` +
          `${esc(p.from || '')} ถึง ${esc(p.until || '')}<br>${esc(p.conditions || '')}<br>` +
          `<a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}" target="_blank" rel="noopener">นำทาง</a> · ${srcLink(p.source)}`,
      )
      .addTo(layers.parking);
  }

  // รวมข่าวตามสถานที่ ไม่ให้หมุดซ้อนกัน
  const byPlace = new Map();
  for (const n of news?.items || []) {
    for (const pl of n.places || []) {
      const cur = byPlace.get(pl.name) || { place: pl, items: [] };
      cur.items.push(n);
      byPlace.set(pl.name, cur);
    }
  }
  for (const { place, items } of byPlace.values()) {
    const list = items
      .slice(0, 6)
      .map((n) => `<li><a href="${esc(safeUrl(n.link) || '#')}" target="_blank" rel="noopener">${esc(n.title)}</a></li>`)
      .join('');
    L.circleMarker([place.lat, place.lon], {
      radius: Math.min(6 + items.length, 14), color: '#fff', weight: 1.5, fillColor: '#64748b', fillOpacity: 0.75,
    })
      .bindPopup(`<b>${esc(place.name)}</b> <span class="tiny">(${items.length} ข่าว · ตำแหน่งโดยประมาณ)</span><ul>${list}</ul>`)
      .addTo(layers.news);
  }

  // ครั้งแรก: ซูมให้เห็นจุดน้ำท่วม/เฝ้าระวัง/ที่จอดรถทั้งหมด
  if (fit) {
    const pts = [...(curated?.floodPoints || []), ...(curated?.watchPoints || []), ...(curated?.parking || [])]
      .filter((p) => p.inBangkok !== false || p.lat < 14.2) // ไม่ดึงแผนที่ไปไกลถึงต่างจังหวัด
      .map((p) => [p.lat, p.lon]);
    if (pts.length > 1) ctx.map.fitBounds(L.latLngBounds(pts).pad(0.1), { maxZoom: 13 });
  }
}

export function setLocation(ctx, loc) {
  if (!ctx) return;
  ctx.locMarker.setLatLng([loc.lat, loc.lon]);
}

export function toggleLayer(ctx, key, on) {
  if (!ctx) return;
  const g = ctx.layers[key];
  if (on) g.addTo(ctx.map);
  else ctx.map.removeLayer(g);
}

// ---------- เรดาร์ ----------
const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });

export async function enableRadar(ctx, { onTime, onError }) {
  if (!ctx) return;
  const r = ctx.radar;
  try {
    const { host, frames, nowcastFrom } = await fetchRadarFrames();
    if (!frames.length) throw new Error('ไม่มีเฟรมเรดาร์');
    r.frames = frames;
    r.nowcastFrom = nowcastFrom;
    ctx.layers.radar.clearLayers();
    // ฟรีเทียร์ของ RainViewer ให้ภาพถึงซูม 7 — Leaflet จะขยายภาพให้เองที่ซูมสูงกว่า
    r.tiles = frames.map((f) =>
      L.tileLayer(`${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
        opacity: 0, maxNativeZoom: 7, maxZoom: 18, zIndex: 400, attribution: 'Radar &copy; RainViewer',
      }).addTo(ctx.layers.radar),
    );
    ctx.layers.radar.addTo(ctx.map);
    showFrame(ctx, nowcastFrom - 1, onTime); // เฟรมล่าสุดที่เป็นข้อมูลจริง
  } catch (e) {
    onError?.(e);
  }
}

export function disableRadar(ctx) {
  if (!ctx) return;
  stopRadar(ctx);
  ctx.map.removeLayer(ctx.layers.radar);
}

function showFrame(ctx, idx, onTime) {
  const r = ctx.radar;
  if (!r.tiles.length) return;
  r.idx = (idx + r.tiles.length) % r.tiles.length;
  r.tiles.forEach((t, i) => t.setOpacity(i === r.idx ? 0.7 : 0));
  const f = r.frames[r.idx];
  onTime?.(`${timeFmt.format(new Date(f.time * 1000))} น.${r.idx >= r.nowcastFrom ? ' (คาดการณ์)' : ''}`);
}

export function toggleRadarPlay(ctx, onTime) {
  const r = ctx.radar;
  if (r.timer) {
    stopRadar(ctx);
    return false;
  }
  r.timer = setInterval(() => showFrame(ctx, r.idx + 1, onTime), 700);
  return true;
}

function stopRadar(ctx) {
  clearInterval(ctx.radar.timer);
  ctx.radar.timer = null;
}
