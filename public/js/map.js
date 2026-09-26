// แผนที่: เลือกใช้ Google Maps (เมื่อมี API key) หรือ Leaflet + OpenStreetMap (ค่าเริ่มต้น ไม่ต้องใช้ key)
// ทั้งสองแบบรับข้อมูลชุดเดียวกันจาก mapfeatures.js และมีเมธอดเหมือนกัน (ดู engine ด้านล่าง)
import { fetchRadarFrames } from './api.js';
import { LAYER_KEYS } from './mapfeatures.js';

export { depthColor } from './mapfeatures.js';

/**
 * สร้างแผนที่ Leaflet
 * engine: { kind, setFeatures, setLayer, setLocation, view, fit, focus, resize, setTraffic, radarAdd, radarShow, radarRemove, destroy }
 */
export function leafletEngine(elId, center) {
  const L = window.L;
  if (!L) return null;
  const map = L.map(elId, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lon], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const groups = Object.fromEntries(LAYER_KEYS.map((k) => [k, L.layerGroup().addTo(map)]));
  const radarGroup = L.layerGroup();
  let radarTiles = [];
  const byId = new Map();
  const locMarker = L.circleMarker([center.lat, center.lon], {
    radius: 6, color: '#0b6fc2', weight: 2, fillColor: '#fff', fillOpacity: 1,
  })
    .addTo(map)
    .bindTooltip('จุดพยากรณ์');

  function build(f) {
    if (f.type === 'line') {
      return L.polyline(f.path, { color: f.color, weight: 6, opacity: 0.85, dashArray: f.dashed ? '10 8' : null });
    }
    if (f.type === 'html') {
      const s = f.size || 22;
      const icon = L.divIcon({ className: '', html: f.html, iconSize: [s, s], iconAnchor: [s / 2, s / 2] });
      return L.marker([f.lat, f.lon], { icon, title: f.title });
    }
    return L.circleMarker([f.lat, f.lon], { radius: f.radius || 8, color: '#fff', weight: 2, fillColor: f.color, fillOpacity: 0.9 });
  }

  return {
    kind: 'leaflet',
    map,
    setFeatures(features) {
      Object.values(groups).forEach((g) => g.clearLayers());
      byId.clear();
      for (const f of features) {
        const layer = build(f).bindPopup(f.popup);
        if (f.type === 'line' && f.title) layer.bindTooltip(f.title, { sticky: true });
        layer.addTo(groups[f.layer]);
        if (f.id) byId.set(f.id, layer);
      }
    },
    setLayer(key, on) {
      const g = groups[key];
      if (!g) return;
      if (on) g.addTo(map);
      else map.removeLayer(g);
    },
    setLocation(loc) {
      locMarker.setLatLng([loc.lat, loc.lon]);
    },
    view(lat, lon, zoom = 15) {
      map.setView([lat, lon], zoom);
    },
    fit(points, maxZoom = 13) {
      if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.1), { maxZoom });
    },
    /** ซูมไปที่ feature (เช่นถนนน้ำท่วม) แล้วเปิดรายละเอียด */
    focus(id) {
      const layer = byId.get(id);
      if (!layer) return false;
      if (layer.getBounds) map.fitBounds(layer.getBounds().pad(0.3), { maxZoom: 16 });
      else map.setView(layer.getLatLng(), 15);
      layer.openPopup();
      return true;
    },
    resize() {
      map.invalidateSize();
    },
    /** Leaflet ไม่มีข้อมูลจราจรสด — ให้แอปแสดงลิงก์ไป Google Maps แทน */
    setTraffic() {
      return false;
    },
    // ฟรีเทียร์ของ RainViewer ให้ภาพถึงซูม 7 — Leaflet ขยายภาพให้เองที่ซูมสูงกว่า
    radarAdd(templates) {
      radarGroup.clearLayers();
      radarTiles = templates.map((t) =>
        L.tileLayer(t, { opacity: 0, maxNativeZoom: 7, maxZoom: 18, zIndex: 400, attribution: 'Radar &copy; RainViewer' }).addTo(radarGroup),
      );
      radarGroup.addTo(map);
    },
    radarShow(idx) {
      radarTiles.forEach((t, i) => t.setOpacity(i === idx ? 0.7 : 0));
    },
    radarRemove() {
      map.removeLayer(radarGroup);
    },
    destroy() {
      map.remove();
    },
  };
}

/**
 * สร้างแผนที่ตามที่ตั้งค่า: มี key → Google Maps (ถ้าโหลดไม่สำเร็จจะใช้ Leaflet แทน)
 * onAuthFailure: Google แจ้งว่า key ใช้ไม่ได้ (เกิดหลังแผนที่โหลดแล้ว) — แอปควรสลับกลับเป็น Leaflet
 */
export async function createMapEngine(elId, center, { googleKey, onAuthFailure, onFallback } = {}) {
  if (googleKey) {
    try {
      const { googleEngine } = await import('./gmap.js');
      return await googleEngine(elId, center, googleKey, { onAuthFailure });
    } catch (e) {
      onFallback?.(e);
      document.getElementById(elId).innerHTML = '';
    }
  }
  return leafletEngine(elId, center);
}

// ---------- เรดาร์ (ใช้ได้กับทั้งสองแบบ) ----------
const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const radarState = new WeakMap();

export async function enableRadar(eng, { onTime, onError }) {
  if (!eng) return;
  try {
    const { host, frames, nowcastFrom } = await fetchRadarFrames();
    if (!frames.length) throw new Error('ไม่มีเฟรมเรดาร์');
    const r = { frames, nowcastFrom, idx: 0, timer: null, onTime };
    radarState.set(eng, r);
    eng.radarAdd(frames.map((f) => `${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`));
    showFrame(eng, nowcastFrom - 1); // เฟรมล่าสุดที่เป็นข้อมูลจริง
  } catch (e) {
    onError?.(e);
  }
}

export function disableRadar(eng) {
  if (!eng) return;
  stopRadar(eng);
  radarState.delete(eng);
  eng.radarRemove();
}

function showFrame(eng, idx) {
  const r = radarState.get(eng);
  if (!r) return;
  r.idx = (idx + r.frames.length) % r.frames.length;
  eng.radarShow(r.idx);
  const f = r.frames[r.idx];
  r.onTime?.(`${timeFmt.format(new Date(f.time * 1000))} น.${r.idx >= r.nowcastFrom ? ' (คาดการณ์)' : ''}`);
}

export function toggleRadarPlay(eng) {
  const r = eng && radarState.get(eng);
  if (!r) return false;
  if (r.timer) {
    stopRadar(eng);
    return false;
  }
  r.timer = setInterval(() => showFrame(eng, r.idx + 1), 700);
  return true;
}

function stopRadar(eng) {
  const r = radarState.get(eng);
  if (!r) return;
  clearInterval(r.timer);
  r.timer = null;
}
