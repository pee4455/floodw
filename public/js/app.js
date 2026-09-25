import { DEFAULT_LOCATION, EMERGENCY_CONTACTS, USEFUL_LINKS, ENSEMBLE_MODELS, FORECAST_MODELS } from './config.js';
import { BANGKOK_DISTRICTS } from './gazetteer.js';
import { fetchModels, fetchEnsembles, fetchTide, fetchLocalData } from './api.js';
import { analyze } from './analysis.js';
import { renderRainChart, renderGauge } from './chart.js';
import { createMap, renderMapData, setLocation, toggleLayer, enableRadar, disableRadar, toggleRadarPlay } from './map.js';
import { esc, safeUrl, fmtDateTime, fmtDate, timeAgo, depthLabel, mm, pct, parkingState } from './util.js';

const $ = (id) => document.getElementById(id);
const REFRESH_MS = 30 * 60 * 1000;
const CATEGORY_LABELS = {
  parking: 'ที่จอดรถ',
  flood: 'จุดน้ำท่วม',
  river: 'แม่น้ำ/เขื่อน',
  weather: 'พยากรณ์/เตือนภัย',
  help: 'ช่วยเหลือ',
  traffic: 'จราจร',
};

const state = {
  loc: DEFAULT_LOCATION,
  curated: null,
  news: null,
  result: null,
  modelResults: [],
  ensResults: [],
  mapCtx: null,
  newsFilter: { cat: null, q: '', bkk: false },
};

// ---------- ตำแหน่ง ----------
const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
};

function initLocationSelect() {
  const sel = $('loc');
  const opts = [
    `<option value="center">${esc(DEFAULT_LOCATION.name)}</option>`,
    '<option value="gps">📍 ตำแหน่งของฉัน</option>',
    '<optgroup label="เขตในกรุงเทพฯ">',
    ...[...BANGKOK_DISTRICTS]
      .sort((a, b) => a.name.localeCompare(b.name, 'th'))
      .map((d) => `<option value="d:${esc(d.name)}">เขต${esc(d.name)}</option>`),
    '</optgroup>',
  ];
  sel.innerHTML = opts.join('');
  const saved = store.get('loc');
  if (saved?.lat && saved?.lon) {
    state.loc = saved;
    const key = saved.key || 'center';
    if ([...sel.options].some((o) => o.value === key)) sel.value = key;
    else sel.value = 'center';
  }
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === 'gps') {
      if (!navigator.geolocation) return setStatus('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง', true);
      setStatus('กำลังหาตำแหน่ง…');
      navigator.geolocation.getCurrentPosition(
        (pos) => changeLocation({ key: 'gps', name: 'ตำแหน่งของฉัน', lat: +pos.coords.latitude.toFixed(3), lon: +pos.coords.longitude.toFixed(3) }),
        () => setStatus('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง', true),
        { timeout: 10000 },
      );
      return;
    }
    if (v === 'center') return changeLocation({ ...DEFAULT_LOCATION, key: 'center' });
    const d = BANGKOK_DISTRICTS.find((x) => `d:${x.name}` === v);
    if (d) changeLocation({ key: v, name: `เขต${d.name}`, lat: d.lat, lon: d.lon });
  });
}

function changeLocation(loc) {
  state.loc = loc;
  store.set('loc', loc);
  setLocation(state.mapCtx, loc);
  loadForecast();
}

// ---------- สถานะ ----------
function setStatus(msg, warn = false) {
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('warn', !!warn);
}

// ---------- แท็บ ----------
function initTabs() {
  const buttons = [...document.querySelectorAll('.tabs button')];
  const show = (name, push = true) => {
    buttons.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
    if (push) history.replaceState(null, '', `#${name}`);
    if (name === 'map') ensureMap();
    if (name === 'forecast' && state.result) renderRainChart($('rain-chart'), state.result.chart);
  };
  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) {
      show(g.dataset.goto);
      window.scrollTo({ top: 0 });
    }
  });
  const initial = location.hash.slice(1);
  if (buttons.some((b) => b.dataset.tab === initial)) show(initial, false);
}

// ---------- พยากรณ์ ----------
let loading = false;
async function loadForecast() {
  if (loading) return;
  loading = true;
  setStatus(`กำลังโหลดพยากรณ์ ${state.loc.name} จาก ${FORECAST_MODELS.length} โมเดล + ensemble…`);
  try {
    const [models, ensembles, tide] = await Promise.all([fetchModels(state.loc), fetchEnsembles(state.loc), fetchTide()]);
    state.modelResults = models;
    state.ensResults = ensembles;
    const okCount = models.filter((m) => m.data).length;
    if (okCount === 0) {
      setStatus('โหลดพยากรณ์ไม่สำเร็จ (ตรวจสอบอินเทอร์เน็ต) — ยังดูข่าว/จุดน้ำท่วม/ที่จอดรถได้ตามปกติ', true);
      renderModelStatus();
      return;
    }
    state.result = analyze({
      models,
      ensembles,
      tide,
      riverAlert: state.curated?.riverAlert ?? 0,
      now: Date.now() / 1000,
    });
    renderForecast();
    const failed = models.filter((m) => !m.data).length + ensembles.filter((e) => !e.members.length).length;
    setStatus(failed ? `บางโมเดลโหลดไม่สำเร็จ (${failed}) — คำนวณจากโมเดลที่เหลือ` : '', !!failed);
    $('foot-updated').textContent = `พยากรณ์อัปเดต ${fmtDateTime(new Date().toISOString())} · อัปเดตอัตโนมัติทุก 30 นาที`;
  } catch (e) {
    console.error(e);
    setStatus(`เกิดข้อผิดพลาด: ${e.message}`, true);
  } finally {
    loading = false;
  }
}

function renderForecast() {
  const r = state.result;
  $('loc-name').textContent = `· ${state.loc.name}`;

  // ความเสี่ยง
  const { risk } = r;
  renderGauge($('gauge'), risk.score, risk.level?.color);
  $('risk-level').textContent = risk.level ? `ระดับ${risk.level.label}` : 'ไม่มีข้อมูล';
  $('risk-level').style.color = risk.level?.color || '';
  $('risk-advice').textContent = risk.level?.advice || '';
  $('risk-factors').innerHTML = risk.factors
    .map(
      (f) => `<li><span>${esc(f.label)}</span><span>${f.value == null ? '–' : `${f.value.toFixed(0)}/${f.max}`}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${f.value == null ? 0 : (f.value / f.max) * 100}%"></span></span>
      <span class="detail">${esc(f.detail)}</span></li>`,
    )
    .join('');

  // ตัวเลขหลัก
  $('s-rain24').textContent = mm(r.rain24);
  $('s-rain24-class').textContent = r.rain24Class ? r.rain24Class.label : 'ไม่มีฝน/เล็กน้อยมาก';
  $('s-rain24p90').textContent = mm(r.rain24P90, 0);
  $('s-pheavy').textContent = pct(r.probHeavy24);
  $('s-now').textContent = r.current.temp == null ? '–' : `${r.current.temp.toFixed(0)}°C`;
  $('s-now-note').textContent = [
    r.current.feels != null ? `รู้สึก ${r.current.feels.toFixed(0)}°` : '',
    r.current.rh != null ? `ชื้น ${r.current.rh.toFixed(0)}%` : '',
    r.current.wind != null ? `ลม ${r.current.wind.toFixed(0)} กม./ชม.` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const hFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
  $('next-hours').innerHTML = r.nextHours
    .map(
      (h) => `<div class="hour"><span>${esc(hFmt.format(new Date((h.time - 3600) * 1000)))}</span>
      <b>${h.rain == null ? '–' : h.rain.toFixed(1)}</b><span class="tiny">มม.</span>
      <div class="p">${h.prob == null ? '' : pct(h.prob)}</div></div>`,
    )
    .join('');

  // กราฟ + ตารางรายวัน
  if ($('tab-forecast').classList.contains('active')) renderRainChart($('rain-chart'), r.chart);
  const dayFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' });
  const head = `<tr><th>วัน</th><th>ฝน (ค่ากลาง)</th><th>ระดับ</th><th>โอกาส ≥10</th><th>≥35</th><th>≥90 มม.</th><th>อุณหภูมิ</th><th>โมเดลเห็นตรงกัน</th>${r.models
    .map((m) => `<th title="${esc(m.label)}" style="color:${m.color}">${esc(m.label.split(' ')[0])}</th>`)
    .join('')}</tr>`;
  const agreeColor = { high: '#16a34a', mid: '#ca8a04', low: '#dc2626' };
  const rows = r.daily
    .map(
      (d) => `<tr><td>${esc(dayFmt.format(new Date(d.dayStart * 1000)))}</td>
      <td><b>${mm(d.consensus)}</b></td>
      <td>${d.rainClass ? `<span class="pill" style="background:${d.rainClass.color}">${esc(d.rainClass.label)}</span>` : '–'}</td>
      <td>${pct(d.p10)}</td><td>${pct(d.p35)}</td><td>${pct(d.p90)}</td>
      <td>${d.tmin == null ? '–' : `${d.tmin.toFixed(0)}–${d.tmax.toFixed(0)}°`}</td>
      <td>${d.agreement ? `<span class="pill" style="background:${agreeColor[d.agreement.key]}">${esc(d.agreement.label)}</span>` : '–'}</td>
      ${d.totals.map((v) => `<td class="muted">${v == null ? '–' : v.toFixed(0)}</td>`).join('')}</tr>`,
    )
    .join('');
  $('daily-table').innerHTML = `<thead>${head}</thead><tbody>${rows}</tbody>`;
  renderModelStatus();
}

function renderModelStatus() {
  const totalW = state.modelResults.filter((m) => m.data).reduce((s, m) => s + m.model.weight, 0) || 1;
  $('model-status').innerHTML =
    '<li><b>โมเดลหลัก (น้ำหนักในค่ากลาง)</b><span></span></li>' +
    state.modelResults
      .map(
        (m) => `<li><span style="color:${m.model.color}">● ${esc(m.model.label)}</span>
        <span class="${m.data ? 'ok' : 'err'}">${m.data ? `${Math.round((m.model.weight / totalW) * 100)}%` : 'โหลดไม่สำเร็จ'}</span></li>`,
      )
      .join('');
  $('ens-status').innerHTML =
    '<li><b>Ensemble (คำนวณโอกาส)</b><span></span></li>' +
    (state.ensResults.length ? state.ensResults : ENSEMBLE_MODELS.map((model) => ({ model, members: [] })))
      .map(
        (e) => `<li><span>${esc(e.model.label)}</span>
        <span class="${e.members.length ? 'ok' : 'err'}">${e.members.length ? `${e.members.length} สมาชิก` : 'โหลดไม่สำเร็จ'}</span></li>`,
      )
      .join('');
}

// ---------- ข้อมูลคัดกรอง / ข่าว ----------
async function loadData() {
  const [curated, news] = await Promise.all([fetchLocalData('curated'), fetchLocalData('news')]);
  state.curated = curated;
  state.news = news;
  renderSituation();
  renderParking();
  renderNews();
  if (state.mapCtx) renderMapData(state.mapCtx, { curated, news });
}

function newsItemHtml(n) {
  const link = safeUrl(n.link);
  const tags = (n.categories || []).map((c) => `<span class="tag ${esc(c)}">${esc(CATEGORY_LABELS[c] || c)}</span>`).join('');
  const depth = n.depthCm ? `<span class="tag depth">น้ำ ${esc(depthLabel(n.depthCm))}</span>` : '';
  const places = (n.places || []).map((p) => p.name).join(', ');
  const when = n.published ? (n.dateOnly ? fmtDate(n.published) : `${timeAgo(n.published)}`) : 'ไม่ทราบเวลา';
  return `<li><a class="title" href="${esc(link || '#')}" target="_blank" rel="noopener">${esc(n.title)}</a>
    <div class="meta"><span>${esc(n.source || '')}</span><span>· ${esc(when)}</span>${tags}${depth}
    ${places ? `<span>📍 ${esc(places)}</span>` : ''}</div></li>`;
}

function renderSituation() {
  const c = state.curated;
  if (!c) {
    $('sit-headline').textContent = 'โหลดข้อมูลสถานการณ์ไม่สำเร็จ';
    return;
  }
  $('sit-updated').textContent = `· อัปเดต ${fmtDateTime(c.updatedAt)}`;
  $('sit-headline').textContent = c.situation?.headline || '';
  $('sit-points').innerHTML = (c.situation?.points || []).map((p) => `<li>${esc(p)}</li>`).join('');
  $('sit-sources').innerHTML = (c.situation?.sources || [])
    .map((s) => `<li><a href="${esc(safeUrl(s.url) || '#')}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`)
    .join('');
  const active = (c.floodPoints || []).filter((p) => p.status !== 'cleared').length;
  const openParking = (c.parking || []).filter((p) => parkingState(p) === 'open').length;
  $('sit-counts').innerHTML = `<button type="button" data-goto="map">🌊 จุดน้ำท่วม ${active} จุด</button>
    <button type="button" data-goto="parking">🅿️ ที่จอดรถเปิดอยู่ ${openParking} แห่ง</button>
    <button type="button" data-goto="map">🔵 จุดเฝ้าระวัง ${(c.watchPoints || []).length} จุด</button>`;
  $('tips').innerHTML = (c.tips || []).map((t) => `<li>${esc(t)}</li>`).join('');
}

function renderParking() {
  const list = state.curated?.parking || [];
  const order = { open: 0, soon: 1, closed: 2 };
  const stLabel = { open: 'เปิดอยู่', soon: 'เร็ว ๆ นี้', closed: 'ปิดแล้ว' };
  const sorted = [...list].sort((a, b) => order[parkingState(a)] - order[parkingState(b)] || (b.inBangkok ? 1 : 0) - (a.inBangkok ? 1 : 0));
  $('parking-list').innerHTML = sorted.length
    ? sorted
        .map((p) => {
          const st = parkingState(p);
          const src = safeUrl(p.source?.url);
          return `<div class="pcard">
          <div><span class="badge ${st}">${stLabel[st]}</span> ${p.inBangkok ? '' : '<span class="badge outside">นอก กทม.</span>'} ${p.free ? '<span class="badge open">ฟรี</span>' : ''}</div>
          <h3>${esc(p.name)}</h3>
          <div class="row muted">${esc(p.area || '')}</div>
          <div class="row">🅿️ ${esc(p.floors || '')}${p.capacity ? ` · รับได้ ~${esc(p.capacity.toLocaleString('th-TH'))} คัน` : ''}</div>
          <div class="row">📅 ${esc(fmtDate(p.from))} – ${esc(fmtDate(p.until))}</div>
          ${p.conditions ? `<div class="row">📝 ${esc(p.conditions)}</div>` : ''}
          <div class="actions">
            <a href="https://www.google.com/maps/dir/?api=1&destination=${+p.lat},${+p.lon}" target="_blank" rel="noopener">🧭 นำทาง</a>
            ${p.contact ? `<a href="tel:${esc(p.contact.replace(/[^0-9+]/g, ''))}">📞 ${esc(p.contact)}</a>` : ''}
            ${src ? `<a href="${esc(src)}" target="_blank" rel="noopener">แหล่งข่าว</a>` : ''}
          </div></div>`;
        })
        .join('')
    : '<p class="muted">ยังไม่มีข้อมูล</p>';
  const pNews = (state.news?.items || []).filter((n) => n.categories?.includes('parking')).slice(0, 15);
  $('parking-news').innerHTML = pNews.length ? pNews.map(newsItemHtml).join('') : '<li class="muted">ยังไม่มีข่าว</li>';
}

function initNewsControls() {
  const cats = $('news-cats');
  cats.innerHTML = [['', 'ทั้งหมด'], ...Object.entries(CATEGORY_LABELS)]
    .map(([k, l]) => `<button type="button" data-cat="${k}" aria-pressed="${k === '' ? 'true' : 'false'}">${esc(l)}</button>`)
    .join('');
  cats.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]');
    if (!b) return;
    state.newsFilter.cat = b.dataset.cat || null;
    cats.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderNews();
  });
  $('news-q').addEventListener('input', (e) => {
    state.newsFilter.q = e.target.value.trim();
    renderNews();
  });
  $('news-bkk').addEventListener('change', (e) => {
    state.newsFilter.bkk = e.target.checked;
    renderNews();
  });
}

function renderNews() {
  const items = state.news?.items || [];
  const { cat, q, bkk } = state.newsFilter;
  const filtered = items.filter(
    (n) =>
      (!cat || n.categories?.includes(cat)) &&
      (!bkk || n.bangkok) &&
      (!q || `${n.title} ${n.source} ${(n.places || []).map((p) => p.name).join(' ')}`.includes(q)),
  );
  $('news-list').innerHTML = filtered.length ? filtered.map(newsItemHtml).join('') : '<li class="muted">ไม่พบข่าวตามเงื่อนไข</li>';
  const gen = state.news?.generatedAt;
  $('news-meta').textContent = state.news
    ? `${filtered.length} จาก ${items.length} ข่าว · ดึงข่าวล่าสุด ${fmtDateTime(gen)}${state.news.seed ? ' (ข้อมูลตั้งต้น — ระบบดึงข่าวอัตโนมัติจะอัปเดตทุก 30 นาทีเมื่อเปิดใช้ GitHub Actions)' : ''}`
    : 'โหลดข่าวไม่สำเร็จ';
  $('overview-news').innerHTML = items.slice(0, 6).map(newsItemHtml).join('') || '<li class="muted">ยังไม่มีข่าว</li>';
}

// ---------- แผนที่ ----------
function ensureMap() {
  if (state.mapCtx || !window.L) {
    state.mapCtx?.map.invalidateSize();
    return;
  }
  state.mapCtx = createMap('map', state.loc);
  renderMapData(state.mapCtx, { curated: state.curated, news: state.news }, { fit: true });
  for (const key of ['flood', 'watch', 'parking', 'news']) {
    $(`lyr-${key}`).addEventListener('change', (e) => toggleLayer(state.mapCtx, key, e.target.checked));
  }
  const onTime = (t) => ($('radar-time').textContent = t);
  $('lyr-radar').addEventListener('change', async (e) => {
    $('radar-ctl').hidden = !e.target.checked;
    if (e.target.checked) {
      await enableRadar(state.mapCtx, {
        onTime,
        onError: (err) => {
          $('radar-time').textContent = `โหลดเรดาร์ไม่สำเร็จ (${err.message})`;
        },
      });
    } else {
      disableRadar(state.mapCtx);
      $('radar-play').textContent = '▶';
    }
  });
  $('radar-play').addEventListener('click', () => {
    const playing = toggleRadarPlay(state.mapCtx, onTime);
    $('radar-play').textContent = playing ? '⏸' : '▶';
  });
}

// ---------- ช่วยเหลือ ----------
function renderHelp() {
  $('contacts').innerHTML = EMERGENCY_CONTACTS.map(
    (c) => `<li><span><b>${esc(c.name)}</b><br><span class="tiny muted">${esc(c.note)}</span></span>
    <a class="tel" href="tel:${esc(c.phone)}">${esc(c.phone)}</a></li>`,
  ).join('');
  $('links').innerHTML = USEFUL_LINKS.map(
    (l) => `<li><span><a href="${esc(l.url)}" target="_blank" rel="noopener"><b>${esc(l.name)}</b></a><br>
    <span class="tiny muted">${esc(l.note)}</span></span></li>`,
  ).join('');
}

function initWindy() {
  $('load-windy').addEventListener('click', () => {
    const wrap = $('windy-wrap');
    const { lat, lon } = state.loc;
    const src = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&detailLat=${lat}&detailLon=${lon}&zoom=8&level=surface&overlay=rain&product=ecmwf&menu=&message=true&marker=true&calendar=now&type=map&location=coordinates&detail=true&metricWind=km%2Fh&metricTemp=%C2%B0C`;
    wrap.innerHTML = `<iframe src="${esc(src)}" title="Windy ECMWF rain map" loading="lazy"></iframe>`;
    wrap.hidden = false;
    $('load-windy').hidden = true;
  });
}

// ---------- เริ่มต้น ----------
function init() {
  initLocationSelect();
  initTabs();
  initNewsControls();
  initWindy();
  renderHelp();
  $('refresh').addEventListener('click', () => {
    loadData();
    loadForecast();
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.result && $('tab-forecast').classList.contains('active')) renderRainChart($('rain-chart'), state.result.chart);
    }, 200);
  });
  loadData().then(loadForecast);
  setInterval(() => {
    loadData();
    loadForecast();
  }, REFRESH_MS);
}

init();
