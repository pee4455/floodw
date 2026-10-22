// แท็บ "ที่จอดรถ" (ทั่วไป): แผนที่ + รายการที่จอดแถวนี้ ค่าจอด เวลาเปิด-ปิด ประมาณค่าจอดตามเวลาที่จะจอด
// ข้อมูล: OpenStreetMap (parking_osm.json) + ค่าจอดที่ผู้ดูแลตรวจสอบ (parking_rates.json)
import { KIND_LABEL, openStatus, rateLabel, estimateCost, floodNote, mergeRates, filterVenues } from './parking.js';
import { distanceKm } from './cams.js';
import { esc, safeUrl, fmtDate, fmtDateTime } from './util.js';

const $ = (id) => document.getElementById(id);
const PAGE = 30;
const JODNAI_URL = 'https://jodnai.com/th';

const gp = {
  venues: [],
  osm: null,
  q: '',
  filter: '',
  hours: 2,
  sort: 'near',
  limit: PAGE,
  loc: null,
  map: null,
  layer: null,
  markers: new Map(),
};

/** สีหมุด: ฟรี/มีชั่วโมงฟรี = เขียว, รู้ราคา = น้ำเงิน, ห้าง = ม่วง, ไม่มีข้อมูล = เทา */
function pinColor(v) {
  const r = v.rate;
  if (r?.free || r?.freeHours > 0) return '#16a34a';
  if (r && (r.perHour != null || r.perDay != null || r.flat != null || r.firstThb != null)) return '#2563eb';
  if (v.kind === 'mall') return '#7c3aed';
  return '#94a3b8';
}

const STATUS_BADGE = { open: 'เปิด', soon: 'กำลังจะปิด', closed: 'ปิด', unknown: 'ไม่ทราบเวลา' };

function costText(v) {
  const c = estimateCost(v.rate, gp.hours);
  if (c == null) return '';
  return c === 0 ? `จอด ${gp.hours} ชม. ฟรี` : `จอด ${gp.hours} ชม. ≈ ${c.toLocaleString('th-TH')} บาท`;
}

function hoursText(v, st) {
  return v.kind === 'mall' && v.hours ? `เวลาห้าง: ${st.label}` : st.label;
}

function osmUrl(v) {
  return /^(node|way|relation)\/\d+$/.test(v.id) ? `https://www.openstreetmap.org/${v.id}` : null;
}

function cardHtml(v, refName) {
  const st = openStatus(v.hours);
  const fn = floodNote(v);
  const cost = costText(v);
  const src = safeUrl(v.verified?.source?.url);
  const osm = osmUrl(v);
  const details = [
    v.dist != null ? `ห่างจาก${esc(refName)} ~${v.dist < 1 ? v.dist.toFixed(1) : v.dist.toFixed(0)} กม.` : '',
    v.capacity ? `รับได้ ~${esc(v.capacity.toLocaleString('th-TH'))} คัน` : '',
    v.access === 'customers' ? 'เฉพาะลูกค้า' : '',
    v.ev ? `ชาร์จ EV ${esc(v.ev)} จุด` : '',
    v.covered ? 'มีหลังคา' : '',
  ].filter(Boolean);
  return `<div class="pcard gp-card" data-gp-card="${esc(v.id)}">
    <div><span class="badge ${st.state}">${STATUS_BADGE[st.state]}</span> <span class="badge kind">${esc(KIND_LABEL[v.kind] || v.kind)}</span>
      ${v.verified ? '<span class="badge verified">✓ ตรวจสอบค่าจอดแล้ว</span>' : ''}</div>
    <h3>${esc(v.name)}${v.nameEn ? ` <span class="tiny muted">${esc(v.nameEn)}</span>` : ''}</h3>
    <div class="row gp-rate">💰 ${esc(rateLabel(v.rate))}</div>
    ${cost ? `<div class="row gp-cost">${esc(cost)}</div>` : ''}
    <div class="row muted">⏰ ${esc(hoursText(v, st))}</div>
    ${details.length ? `<div class="row muted">${details.join(' · ')}</div>` : ''}
    ${fn ? `<div class="row gp-flood ${fn.level}">${fn.level === 'warn' ? '⚠️' : '🏢'} ${esc(fn.text)}</div>` : ''}
    ${v.rateNote ? `<div class="row">📝 ${esc(v.rateNote)}</div>` : ''}
    ${src ? `<div class="row tiny muted">ค่าจอดจาก <a href="${esc(src)}" target="_blank" rel="noopener">${esc(v.verified.source.title || 'แหล่งทางการ')}</a>${v.verified.checkedAt ? ` · ตรวจ ${esc(fmtDate(v.verified.checkedAt))}` : ''}</div>` : ''}
    <div class="actions">
      <a href="https://www.google.com/maps/dir/?api=1&destination=${+v.lat},${+v.lon}" target="_blank" rel="noopener">🧭 นำทาง</a>
      <button type="button" class="linkish" data-gp-map="${esc(v.id)}">📍 แผนที่</button>
      ${!v.verified && v.kind === 'mall' ? `<a href="${JODNAI_URL}" target="_blank" rel="noopener">ค่าจอดห้างบน JodNai ↗</a>` : ''}
      ${osm ? `<a href="${esc(osm)}" target="_blank" rel="noopener" title="ข้อมูลผิด/ไม่ครบ ช่วยแก้ใน OpenStreetMap">✎ OSM</a>` : ''}
    </div></div>`;
}

function popupHtml(v) {
  const st = openStatus(v.hours);
  const cost = costText(v);
  return `<b>${esc(v.name)}</b><br><span class="tiny">${esc(KIND_LABEL[v.kind] || '')} · ${esc(hoursText(v, st))}</span>
    <br>💰 ${esc(rateLabel(v.rate))}${cost ? `<br><b>${esc(cost)}</b>` : ''}
    <br><a href="https://www.google.com/maps/dir/?api=1&destination=${+v.lat},${+v.lon}" target="_blank" rel="noopener">นำทาง</a>
    · <button type="button" class="linkish" data-gp-card-go="${esc(v.id)}">ดูรายละเอียด</button>`;
}

/** จุดอ้างอิงระยะทาง: กลางแผนที่ (ถ้าเปิดแผนที่แล้ว) ไม่งั้นพื้นที่ที่เลือกด้านบน */
function reference() {
  if (gp.map) {
    const c = gp.map.getCenter();
    return { lat: c.lat, lon: c.lng, name: 'กลางแผนที่' };
  }
  return gp.loc;
}

function filtered() {
  return filterVenues(gp.venues, { q: gp.q, filter: gp.filter });
}

function renderList() {
  const list = $('gp-list');
  if (!list) return;
  if (!gp.osm) {
    list.innerHTML = '<p class="muted">กำลังโหลดข้อมูลที่จอดรถ…</p>';
    return;
  }
  const ref = reference();
  let items = filtered();
  // ไม่ได้ค้นหา = แสดงเฉพาะที่อยู่ในกรอบแผนที่ (แบบ "ที่จอดรถแถวนี้") · ค้นหา = ทั้งกรุงเทพฯ
  const bounds = gp.map && !gp.q ? gp.map.getBounds() : null;
  if (bounds) items = items.filter((v) => bounds.contains([v.lat, v.lon]));
  items = items.map((v) => ({
    ...v,
    dist: ref ? distanceKm(ref, v) : null,
    closed: openStatus(v.hours).state === 'closed',
    cost: estimateCost(v.rate, gp.hours) ?? Infinity,
  }));
  // ใกล้สุด: ที่ปิดอยู่ไปไว้ท้าย · ถูกสุด: ไม่รู้ราคาไปไว้ท้าย
  items.sort((a, b) => (gp.sort === 'cheap' ? a.cost - b.cost : a.closed - b.closed) || a.dist - b.dist);
  $('gp-count').textContent = `${items.length.toLocaleString('th-TH')} แห่ง${bounds ? 'ในกรอบแผนที่' : gp.q ? ' ที่ตรงกับคำค้น' : ''} · เรียง${gp.sort === 'cheap' ? `จากค่าจอดถูกสุด (จอด ${gp.hours} ชม.)` : `จากใกล้${ref?.name || ''}`}`;
  list.innerHTML = items.length
    ? items
        .slice(0, gp.limit)
        .map((v) => cardHtml(v, ref?.name || ''))
        .join('')
    : `<p class="muted">${bounds ? 'ไม่พบที่จอดในกรอบแผนที่ — ลองซูมออกหรือเลื่อนแผนที่' : 'ไม่พบที่จอดตามเงื่อนไข'}</p>`;
  $('gp-more').hidden = items.length <= gp.limit;
  $('gp-more').textContent = `แสดงเพิ่ม (${items.length - gp.limit} แห่ง)`;
}

function renderMarkers() {
  if (!gp.map) return;
  const L = window.L;
  gp.layer.clearLayers();
  gp.markers.clear();
  for (const v of filtered()) {
    const m = L.circleMarker([v.lat, v.lon], {
      radius: v.kind === 'mall' || v.kind === 'building' ? 7 : 5,
      color: v.kind === 'underground' ? '#ea580c' : '#fff',
      weight: v.kind === 'underground' ? 3 : 1.5,
      fillColor: pinColor(v),
      fillOpacity: 0.9,
    }).bindPopup(() => popupHtml(v));
    m.bindTooltip(v.name);
    m.addTo(gp.layer);
    gp.markers.set(v.id, m);
  }
}

function render() {
  renderMarkers();
  renderList();
}

/** สร้างแผนที่เมื่อเปิดแท็บครั้งแรก (Leaflet ต้องรู้ขนาดกล่องก่อน) */
export function ensureGparkMap() {
  const L = window.L;
  if (gp.map) {
    gp.map.invalidateSize();
    return;
  }
  if (!L || !$('gp-map')) return;
  const c = gp.loc || { lat: 13.7563, lon: 100.5018 };
  gp.map = L.map('gp-map', { preferCanvas: true }).setView([c.lat, c.lon], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(gp.map);
  gp.layer = L.layerGroup().addTo(gp.map);
  let t;
  gp.map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      gp.limit = PAGE;
      renderList();
    }, 150);
  });
  render();
}

export function setGparkLocation(loc) {
  gp.loc = loc;
  if (gp.map) gp.map.setView([loc.lat, loc.lon], Math.max(gp.map.getZoom(), 14));
  else renderList();
}

export function setGparkData(osm, rates) {
  gp.osm = osm;
  gp.venues = mergeRates(osm?.venues, rates);
  const meta = $('gp-meta');
  if (meta) {
    const verified = gp.venues.filter((v) => v.verified).length;
    meta.textContent = osm
      ? `${gp.venues.length.toLocaleString('th-TH')} แห่ง · ข้อมูล OSM ${fmtDateTime(osm.generatedAt)}${verified ? ` · ตรวจสอบค่าจอดแล้ว ${verified} แห่ง` : ''}`
      : 'โหลดข้อมูลที่จอดรถไม่สำเร็จ';
  }
  render();
}

function focusVenue(id) {
  const m = gp.markers.get(id);
  if (!gp.map || !m) return;
  $('gp-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  gp.map.setView(m.getLatLng(), Math.max(gp.map.getZoom(), 17));
  m.openPopup();
}

export function initGpark(loc) {
  gp.loc = loc;
  const setPressed = (el, b) => el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('gp-q').addEventListener('input', (e) => {
    gp.q = e.target.value.trim();
    gp.limit = PAGE;
    render();
  });
  $('gp-filter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-gf]');
    if (!b) return;
    gp.filter = b.dataset.gf;
    gp.limit = PAGE;
    setPressed($('gp-filter'), b);
    render();
  });
  $('gp-hours').addEventListener('change', (e) => {
    gp.hours = Number(e.target.value) || 2;
    renderList();
  });
  $('gp-sort').addEventListener('change', (e) => {
    gp.sort = e.target.value;
    renderList();
  });
  $('gp-more').addEventListener('click', () => {
    gp.limit += PAGE;
    renderList();
  });
  document.addEventListener('click', (e) => {
    const onMap = e.target.closest('[data-gp-map]');
    if (onMap) return focusVenue(onMap.dataset.gpMap);
    const go = e.target.closest('[data-gp-card-go]');
    if (go) {
      const card = document.querySelector(`[data-gp-card="${CSS.escape(go.dataset.gpCardGo)}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card?.classList.add('flash');
      setTimeout(() => card?.classList.remove('flash'), 1500);
    }
  });
  renderList();
}
