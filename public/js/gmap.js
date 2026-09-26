// แผนที่ Google Maps (ต้องมี API key ที่เปิด Maps JavaScript API)
// หมุดวาดเป็น HTML ผ่าน OverlayView ทีละเลเยอร์ (ไม่ต้องใช้ Map ID และหน้าตาเหมือนฝั่ง Leaflet)
import { LAYER_KEYS } from './mapfeatures.js';

const CALLBACK = '__floodwGmapsReady';
let loading = null;

function loadGoogleMaps(key) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('โหลด Google Maps ไม่ทันเวลา')), 15000);
    window[CALLBACK] = () => {
      clearTimeout(timer);
      resolve(window.google.maps);
    };
    const s = document.createElement('script');
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&v=weekly&language=th&region=TH&loading=async&callback=${CALLBACK}`;
    s.async = true;
    s.onerror = () => {
      clearTimeout(timer);
      reject(new Error('โหลด Google Maps ไม่สำเร็จ'));
    };
    document.head.appendChild(s);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

// ลำดับการซ้อนของเลเยอร์ (ค่ามาก = อยู่บน)
const Z = { cams: 1, news: 2, parking: 3, watch: 4, js100: 5, flood: 6, loc: 7 };

export async function googleEngine(elId, center, key, { onAuthFailure } = {}) {
  window.gm_authFailure = () => onAuthFailure?.(); // Google เรียกเมื่อ key ใช้ไม่ได้/ไม่ได้เปิด API/โดเมนไม่ตรง
  const g = await loadGoogleMaps(key);
  const el = document.getElementById(elId);
  const map = new g.Map(el, {
    center: { lat: center.lat, lng: center.lon },
    zoom: 11,
    mapTypeControl: true,
    mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] },
    streetViewControl: false,
    fullscreenControl: true,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });
  const info = new g.InfoWindow({ maxWidth: 300 });
  const openInfo = (f, pos) => {
    if (!f.popup) return;
    const div = document.createElement('div');
    div.className = 'gm-popup';
    div.innerHTML = f.popup();
    info.setContent(div);
    info.setPosition(pos);
    info.open({ map });
  };

  /** หมุด HTML ทั้งเลเยอร์ใน overlay เดียว (กล้องมีเป็นพันตัว — ไม่สร้าง overlay แยกทีละหมุด) */
  class HtmlLayer extends g.OverlayView {
    constructor(z) {
      super();
      this.items = [];
      this.div = document.createElement('div');
      this.div.className = 'gm-layer';
      this.div.style.zIndex = String(z);
      this.div.addEventListener('click', (e) => {
        const pin = e.target.closest('[data-fi]');
        const it = pin && this.items[Number(pin.dataset.fi)];
        if (it) openInfo(it.f, new g.LatLng(it.f.lat, it.f.lon));
      });
    }
    setItems(features) {
      this.div.textContent = '';
      this.items = features.map((f, i) => {
        const pin = document.createElement('div');
        pin.className = 'gm-pin';
        pin.dataset.fi = String(i);
        if (f.title) pin.title = f.title;
        const inner = f.type === 'html' ? f.html : `<span class="dot-pin" style="--c:${f.color};--r:${f.radius || 8}px"></span>`;
        pin.innerHTML = `<div class="gm-pin-in">${inner}</div>`;
        this.div.appendChild(pin);
        return { f, pin, ll: new g.LatLng(f.lat, f.lon) };
      });
      this.draw();
    }
    onAdd() {
      this.getPanes().overlayMouseTarget.appendChild(this.div);
      g.OverlayView.preventMapHitsAndGesturesFrom?.(this.div);
    }
    draw() {
      const proj = this.getProjection?.();
      if (!proj) return;
      for (const { pin, ll } of this.items) {
        const p = proj.fromLatLngToDivPixel(ll);
        if (p) pin.style.transform = `translate(${p.x}px, ${p.y}px)`;
      }
    }
    onRemove() {
      this.div.remove();
    }
  }

  const layers = {};
  const lines = Object.fromEntries(LAYER_KEYS.map((k) => [k, []]));
  const visible = Object.fromEntries(LAYER_KEYS.map((k) => [k, true]));
  for (const k of LAYER_KEYS) {
    layers[k] = new HtmlLayer(Z[k] || 1);
    layers[k].setMap(map);
  }
  const byId = new Map();

  const locLayer = new HtmlLayer(Z.loc);
  locLayer.setMap(map);
  const setLoc = (loc) => locLayer.setItems([{ type: 'html', lat: loc.lat, lon: loc.lon, html: '<span class="loc-pin"></span>', title: 'จุดพยากรณ์' }]);
  setLoc(center);

  const traffic = new g.TrafficLayer();
  let radarTypes = [];

  function makeLine(f) {
    const dash = { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: f.color, scale: 4 };
    const line = new g.Polyline({
      path: f.path.map(([lat, lng]) => ({ lat, lng })),
      strokeColor: f.color,
      strokeOpacity: f.dashed ? 0 : 0.85,
      strokeWeight: 6,
      icons: f.dashed ? [{ icon: dash, offset: '0', repeat: '16px' }] : [],
      zIndex: 10,
    });
    line.addListener('click', (e) => openInfo(f, e.latLng));
    return line;
  }

  /** เรดาร์ RainViewer ฟรีถึงซูม 7 — ซูมสูงกว่านั้นตัดส่วนของไทล์ซูม 7 มาขยาย (วาดบน canvas) */
  class RadarType {
    constructor(tpl) {
      this.tpl = tpl;
      this.tileSize = new g.Size(256, 256);
      this.tiles = new Set();
      this.opacity = 0;
    }
    getTile(coord, zoom, doc) {
      const c = doc.createElement('canvas');
      c.width = c.height = 256;
      c.style.opacity = String(this.opacity);
      const n = 2 ** zoom;
      const x = ((coord.x % n) + n) % n;
      const y = coord.y;
      if (y < 0 || y >= n) return c;
      const dz = Math.max(0, zoom - 7);
      const s = 2 ** dz;
      const img = new Image();
      img.onload = () => {
        const sw = 256 / s;
        c.getContext('2d').drawImage(img, (x % s) * sw, (y % s) * sw, sw, sw, 0, 0, 256, 256);
      };
      img.src = this.tpl.replace('{z}', String(zoom - dz)).replace('{x}', String(Math.floor(x / s))).replace('{y}', String(Math.floor(y / s)));
      this.tiles.add(c);
      return c;
    }
    releaseTile(c) {
      this.tiles.delete(c);
    }
    setOpacity(o) {
      this.opacity = o;
      for (const t of this.tiles) t.style.opacity = String(o);
    }
  }

  return {
    kind: 'google',
    map,
    setFeatures(features) {
      for (const k of LAYER_KEYS) {
        lines[k].forEach((l) => l.setMap(null));
        lines[k] = [];
      }
      byId.clear();
      const points = Object.fromEntries(LAYER_KEYS.map((k) => [k, []]));
      for (const f of features) {
        if (f.type === 'line') {
          const line = makeLine(f);
          if (visible[f.layer]) line.setMap(map);
          lines[f.layer].push(line);
          if (f.id) byId.set(f.id, { f, line });
        } else {
          points[f.layer].push(f);
          if (f.id) byId.set(f.id, { f });
        }
      }
      for (const k of LAYER_KEYS) layers[k].setItems(points[k]);
    },
    setLayer(key, on) {
      if (!layers[key]) return;
      visible[key] = on;
      layers[key].setMap(on ? map : null);
      lines[key].forEach((l) => l.setMap(on ? map : null));
    },
    setLocation: setLoc,
    view(lat, lon, zoom = 15) {
      map.setCenter({ lat, lng: lon });
      map.setZoom(zoom);
    },
    fit(points, maxZoom = 13) {
      if (points.length < 2) return;
      const b = new g.LatLngBounds();
      points.forEach(([lat, lng]) => b.extend({ lat, lng }));
      map.fitBounds(b, 30);
      g.event.addListenerOnce(map, 'idle', () => {
        if (map.getZoom() > maxZoom) map.setZoom(maxZoom);
      });
    },
    focus(id) {
      const hit = byId.get(id);
      if (!hit) return false;
      const { f } = hit;
      if (f.path) {
        const b = new g.LatLngBounds();
        f.path.forEach(([lat, lng]) => b.extend({ lat, lng }));
        map.fitBounds(b, 60);
      } else {
        map.setCenter({ lat: f.lat, lng: f.lon });
        map.setZoom(15);
      }
      openInfo(f, new g.LatLng(f.lat, f.lon));
      return true;
    },
    resize() {},
    setTraffic(on) {
      traffic.setMap(on ? map : null);
      return true;
    },
    radarAdd(templates) {
      map.overlayMapTypes.clear();
      radarTypes = templates.map((t) => new RadarType(t));
      radarTypes.forEach((t) => map.overlayMapTypes.push(t));
    },
    radarShow(idx) {
      radarTypes.forEach((t, i) => t.setOpacity(i === idx ? 0.7 : 0));
    },
    radarRemove() {
      map.overlayMapTypes.clear();
      radarTypes = [];
    },
    destroy() {
      traffic.setMap(null);
      el.textContent = '';
    },
  };
}
