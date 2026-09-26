// หน้าแผนที่: เลือกโหมด (ปกติ/จราจร/น้ำท่วม), เปิด-ปิดเลเยอร์, แผงรายการถนนน้ำท่วม/รายงาน จส.100 และตั้งค่า Google Maps
import { createMapEngine, leafletEngine, enableRadar, disableRadar, toggleRadarPlay } from './map.js';
import { buildFeatures, fitPoints, MODES, LAYER_KEYS, googleTrafficUrl, js100Kinds, filterJs100, filterRoads } from './mapfeatures.js';
import { GOOGLE_MAPS_API_KEY } from './config.js';
import { esc, safeUrl, fmtDateTime, timeAgo } from './util.js';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'gmapsKey'; // '-' = ผู้ใช้เลือกใช้ OpenStreetMap แม้เว็บจะตั้ง key ไว้
const MODE_STORE = 'mapMode';
const STALE_MS = 6 * 3600 * 1000;

const view = {
  eng: null,
  creating: null,
  fitted: false,
  authFailed: false,
  src: () => ({}),
  mode: 'normal',
  js100Filter: { q: '', kind: '' },
  roadsFilter: { q: '', zone: '' },
};

const local = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

function googleKey() {
  const v = local.get(KEY_STORE);
  if (v === '-') return '';
  return v || GOOGLE_MAPS_API_KEY || '';
}

// ---------- สร้างแผนที่ ----------
export async function ensureMap() {
  if (view.eng) {
    view.eng.resize();
    return view.eng;
  }
  if (view.creating) return view.creating;
  view.creating = (async () => {
    const { loc } = view.src();
    const eng = await createMapEngine('map', loc, {
      googleKey: googleKey(),
      onAuthFailure: () => useLeaflet('Google ปฏิเสธ key นี้ (ยังไม่เปิด Maps JavaScript API, ไม่ได้ผูกบัญชีเรียกเก็บเงิน หรือจำกัดโดเมนไม่ตรง) — ใช้ OpenStreetMap แทน'),
      onFallback: (e) => keyStatus(`โหลด Google Maps ไม่สำเร็จ (${e.message}) — ใช้ OpenStreetMap แทน`),
    });
    if (!eng) return null;
    view.eng = eng;
    afterCreate();
    if (view.authFailed) useLeaflet('Google ปฏิเสธ key นี้ — ใช้ OpenStreetMap แทน');
    return view.eng;
  })();
  try {
    return await view.creating;
  } finally {
    view.creating = null;
  }
}

function useLeaflet(msg) {
  if (!view.eng) {
    view.authFailed = true;
    return;
  }
  if (view.eng.kind !== 'google') return;
  disableRadar(view.eng);
  view.eng.destroy();
  view.eng = leafletEngine('map', view.src().loc);
  view.fitted = false;
  afterCreate();
  keyStatus(msg, true);
}

function afterCreate() {
  const eng = view.eng;
  $('map-attrib').textContent = eng.kind === 'google' ? 'แผนที่: Google Maps' : 'แผนที่: © OpenStreetMap contributors';
  updateKeyUi();
  refreshMap();
  for (const key of LAYER_KEYS) eng.setLayer(key, $(`lyr-${key}`).checked);
  applyTraffic();
  if ($('lyr-radar').checked) startRadar();
}

/** วาดข้อมูลบนแผนที่ใหม่ (เรียกเมื่อข้อมูลอัปเดต) + แผงรายการ */
export function refreshMap() {
  renderPanels();
  if (!view.eng) return;
  const d = view.src();
  view.eng.setFeatures(buildFeatures(d));
  if (!view.fitted && d.curated) {
    view.eng.fit(fitPoints(d.curated));
    view.fitted = true;
  }
}

export function setMapLocation(loc) {
  view.eng?.setLocation(loc);
  $('gmaps-traffic-link').href = googleTrafficUrl(loc.lat, loc.lon, 13);
  applyTraffic();
}

/** เปิดแท็บแผนที่แล้วซูมไปที่พิกัด */
export async function showOnMap(lat, lon, zoom = 15) {
  document.querySelector('.tabs button[data-tab="map"]')?.click();
  const eng = await ensureMap();
  eng?.view(lat, lon, zoom);
}

function scrollToMap() {
  $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- โหมด ----------
function setMode(mode) {
  const m = MODES[mode] || MODES.normal;
  view.mode = MODES[mode] ? mode : 'normal';
  local.set(MODE_STORE, view.mode);
  $('map-mode')
    .querySelectorAll('button')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === view.mode)));
  for (const key of LAYER_KEYS) {
    $(`lyr-${key}`).checked = !!m.layers[key];
    view.eng?.setLayer(key, !!m.layers[key]);
  }
  $('lyr-traffic').checked = m.traffic;
  applyTraffic();
  if ($('lyr-radar').checked !== m.radar) {
    $('lyr-radar').checked = m.radar;
    onRadarToggle();
  }
  $('panel-traffic').hidden = view.mode !== 'traffic';
  $('panel-flood').hidden = view.mode !== 'flood';
  renderPanels();
}

function applyTraffic() {
  const on = $('lyr-traffic').checked;
  const shown = view.eng ? view.eng.setTraffic(on) : false;
  const note = $('traffic-note');
  if (on && view.eng && !shown) {
    const { loc } = view.src();
    note.innerHTML =
      `แผนที่ OpenStreetMap ไม่มีเส้นจราจรสด · <a href="${esc(googleTrafficUrl(loc.lat, loc.lon, 13))}" target="_blank" rel="noopener">เปิด Google Maps (ชั้นจราจร) ↗</a>` +
      ' หรือ <button type="button" data-open-key>ใส่ Google Maps API key</button> เพื่อดูเส้นจราจรในแอป';
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

// ---------- เรดาร์ ----------
const onTime = (t) => ($('radar-time').textContent = t);

function startRadar() {
  enableRadar(view.eng, {
    onTime,
    onError: (err) => {
      $('radar-time').textContent = `โหลดเรดาร์ไม่สำเร็จ (${err.message})`;
    },
  });
}

function onRadarToggle() {
  const on = $('lyr-radar').checked;
  $('radar-ctl').hidden = !on;
  if (!view.eng) return;
  if (on) startRadar();
  else {
    disableRadar(view.eng);
    $('radar-play').textContent = '▶';
  }
}

// ---------- แผงรายการ ----------
function renderPanels() {
  if (view.mode === 'traffic') renderTrafficPanel();
  if (view.mode === 'flood') renderFloodPanel();
}

const KIND_LABEL = { flood: 'น้ำท่วม', accident: 'อุบัติเหตุ/รถเสีย', jam: 'รถติด/ปิดถนน' };

function js100ItemHtml(i) {
  const text = i.text || i.title || '';
  const link = safeUrl(i.link);
  const place = i.places?.[0];
  const tags = js100Kinds(i)
    .map((k) => `<span class="tag ${k === 'flood' ? 'flood' : 'traffic'}">${esc(KIND_LABEL[k])}</span>`)
    .join(' ');
  return `<li>
    <div class="tiny muted">${esc(fmtDateTime(i.published))} · ${esc(timeAgo(i.published))} ${tags}</div>
    <div>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text)}</div>
    ${place ? `<button type="button" class="linkish" data-map-at="${+place.lat},${+place.lon}">📍 ${esc(place.name)} (โดยประมาณ)</button>` : ''}
  </li>`;
}

function renderTrafficPanel() {
  const js = view.src().js100;
  $('js100-age').textContent = js?.generatedAt ? `· ดึงข้อมูล ${timeAgo(js.generatedAt)}` : '';
  const items = filterJs100(js?.traffic, view.js100Filter).slice(0, 25);
  $('js100-list').innerHTML = !js
    ? '<li class="muted">ยังไม่มีข้อมูลจาก จส.100</li>'
    : items.length
      ? items.map(js100ItemHtml).join('')
      : '<li class="muted">ไม่พบรายงานตามเงื่อนไข</li>';
}

function renderFloodPanel() {
  const { floodRoads: fr, js100 } = view.src();
  if (!fr) {
    $('roads-meta').textContent = 'ยังไม่มีข้อมูลถนนน้ำท่วม';
    return;
  }
  const stale = Date.now() - new Date(fr.observedAt).getTime() > STALE_MS;
  const src = safeUrl(fr.source?.url);
  $('roads-meta').innerHTML =
    `<b>ข้อมูล ณ ${esc(fmtDateTime(fr.observedAt))}</b> (${esc(timeAgo(fr.observedAt))})` +
    (stale ? ' <span class="tag flood">ข้อมูลเก่า — เช็กสภาพล่าสุดก่อนเดินทาง</span>' : '') +
    `<br><span class="tiny muted">${esc(fr.method || '')} ${esc(fr.note || '')}` +
    (src ? ` · ที่มา: <a href="${esc(src)}" target="_blank" rel="noopener">${esc(fr.source.title || 'แหล่งข้อมูล')}</a>` : '') +
    '</span>';
  $('roads-closures').innerHTML = fr.googleClosures?.length
    ? `<h3>🚧 Google Maps แจ้งปิดถนน/น้ำท่วม</h3><ul class="small">${fr.googleClosures.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '';
  const zones = [...new Set((fr.roads || []).map((r) => r.zone).filter(Boolean))];
  const zoneEl = $('roads-zone');
  if (zoneEl.dataset.zones !== zones.join('|')) {
    zoneEl.dataset.zones = zones.join('|');
    zoneEl.innerHTML = ['', ...zones]
      .map((z) => `<button type="button" data-zone="${esc(z)}" aria-pressed="${z === view.roadsFilter.zone}">${z ? `โซน${esc(z)}` : 'ทุกโซน'}</button>`)
      .join('');
  }
  const roads = filterRoads(fr.roads, view.roadsFilter);
  $('roads-list').innerHTML = roads.length
    ? roads
        .map(
          (r) => `<li><button type="button" data-road="${esc(`road:${r.name}`)}">
            <span class="lvl ${r.level === 'avoid' ? 'avoid' : 'caution'}">${r.level === 'avoid' ? '⛔ เลี่ยง' : '⚠️ ระวัง'}</span>
            <b>${esc(r.name)}</b> <span class="small">${esc(r.section || '')}</span>
            <span class="tiny muted">เขต ${esc(r.districts || '-')}${r.delayMin ? ` · ช้ากว่าปกติ ~${esc(r.delayMin)} นาที` : ''}${r.note ? ` · ${esc(r.note)}` : ''}</span>
          </button></li>`,
        )
        .join('')
    : '<li class="muted">ไม่พบถนนตามเงื่อนไข</li>';
  $('roads-clear').innerHTML = fr.clearRoutes?.length
    ? `<h3>✅ เส้นทางที่ยังไปได้ (ณ เวลาสำรวจ)</h3><ul class="small">${fr.clearRoutes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`
    : '';
  const floods = [...(js100?.traffic || []), ...(js100?.news || [])]
    // เฉพาะรายงานที่ระบุพื้นที่ในกรุงเทพฯ/ปริมณฑลได้ (จส.100 รายงานต่างจังหวัดด้วย)
    .filter((i) => js100Kinds(i).includes('flood') && (i.places?.length || /กรุงเทพ|กทม/.test(i.text || i.title || '')))
    .sort((a, b) => String(b.published).localeCompare(String(a.published)))
    .slice(0, 15);
  $('js100-flood').innerHTML = floods.length ? floods.map(js100ItemHtml).join('') : '<li class="muted">ยังไม่มีรายงานน้ำท่วมล่าสุด</li>';
}

// ---------- Google Maps API key ----------
function keyStatus(msg, warn = false) {
  const el = $('gmaps-key-status');
  el.textContent = msg || '';
  el.classList.toggle('warn', !!warn);
  if (warn) $('gmaps-key').open = true;
}

function updateKeyUi() {
  const google = view.eng?.kind === 'google';
  $('gmaps-key-summary').textContent = google ? '✅ ใช้ Google Maps อยู่ · ตั้งค่า key' : 'ใช้ Google Maps + จราจรสด (ต้องมี API key)';
  $('gmaps-key-clear').hidden = !googleKey();
}

function initKeyForm() {
  $('gmaps-key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const key = $('gmaps-key-input').value.trim();
    if (!/^[A-Za-z0-9_-]{30,60}$/.test(key)) return keyStatus('รูปแบบ key ไม่ถูกต้อง (มักขึ้นต้นด้วย AIza…)', true);
    local.set(KEY_STORE, key);
    keyStatus('บันทึกแล้ว กำลังโหลดแผนที่ใหม่…');
    location.hash = '#map';
    location.reload(); // สคริปต์ Google Maps เปลี่ยน key ไม่ได้หลังโหลด
  });
  $('gmaps-key-clear').addEventListener('click', () => {
    local.set(KEY_STORE, '-');
    location.hash = '#map';
    location.reload();
  });
}

// ---------- เริ่มต้น ----------
export function initMapView(getData) {
  view.src = getData;
  initKeyForm();
  for (const key of LAYER_KEYS) {
    $(`lyr-${key}`).addEventListener('change', (e) => view.eng?.setLayer(key, e.target.checked));
  }
  $('lyr-traffic').addEventListener('change', applyTraffic);
  $('lyr-radar').addEventListener('change', onRadarToggle);
  $('radar-play').addEventListener('click', () => {
    $('radar-play').textContent = toggleRadarPlay(view.eng) ? '⏸' : '▶';
  });
  $('map-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('js100-q').addEventListener('input', (e) => {
    view.js100Filter.q = e.target.value.trim();
    renderTrafficPanel();
  });
  $('js100-filter').addEventListener('click', (e) => {
    const b = e.target.closest('[data-js]');
    if (!b) return;
    view.js100Filter.kind = b.dataset.js;
    $('js100-filter')
      .querySelectorAll('button')
      .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderTrafficPanel();
  });
  $('roads-q').addEventListener('input', (e) => {
    view.roadsFilter.q = e.target.value.trim();
    renderFloodPanel();
  });
  $('roads-zone').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zone]');
    if (!b) return;
    view.roadsFilter.zone = b.dataset.zone;
    $('roads-zone')
      .querySelectorAll('button')
      .forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderFloodPanel();
  });
  document.addEventListener('click', async (e) => {
    const road = e.target.closest('[data-road]');
    if (road && view.eng) {
      if (!$('lyr-roads').checked) {
        $('lyr-roads').checked = true;
        view.eng.setLayer('roads', true);
      }
      scrollToMap();
      view.eng.focus(road.dataset.road);
      return;
    }
    const at = e.target.closest('[data-map-at]');
    if (at && view.eng) {
      const [lat, lon] = at.dataset.mapAt.split(',').map(Number);
      scrollToMap();
      view.eng.view(lat, lon, 14);
      return;
    }
    if (e.target.closest('[data-open-key]')) {
      $('gmaps-key').open = true;
      $('gmaps-key-input').focus();
    }
  });
  setMode(local.get(MODE_STORE) || 'normal');
  updateKeyUi();
}
