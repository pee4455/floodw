// กราฟ SVG แบบเบา ไม่พึ่งไลบรารีภายนอก

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};

const hourFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric' });

/**
 * กราฟฝนรายชั่วโมง: แท่ง = ค่ากลางหลายโมเดล, เส้นแนวตั้งบาง = ช่วงต่ำสุด–สูงสุดระหว่างโมเดล,
 * เส้นประ = โอกาสฝนตก (ensemble) แกนขวา
 */
export function renderRainChart(container, { time, consensus, min, max, prob, probTime }) {
  container.innerHTML = '';
  if (!time.length) {
    container.textContent = 'ไม่มีข้อมูล';
    return;
  }
  const W = Math.max(container.clientWidth || 640, 320);
  const H = 220;
  const m = { l: 34, r: 36, t: 22, b: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const peak = Math.max(5, ...max.filter((v) => v != null), ...consensus.filter((v) => v != null));
  const step = [1, 2, 2.5, 5, 10, 20, 25, 50].find((st) => st * 4 >= peak) ?? Math.ceil(peak / 200) * 50;
  const yMax = step * 4;
  const n = time.length;
  const bw = iw / n;
  const x = (i) => m.l + i * bw;
  const y = (v) => m.t + ih - (v / yMax) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', class: 'chart' });
  svg.append(el('title', {}, 'กราฟปริมาณฝนรายชั่วโมง ค่ากลางหลายโมเดล และโอกาสฝนตก'));

  // grid + แกนซ้าย (มม.)
  for (let k = 0; k <= 4; k++) {
    const v = (yMax / 4) * k;
    svg.append(el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'grid' }));
    svg.append(el('text', { x: m.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, String(+v.toFixed(1))));
    svg.append(el('text', { x: W - m.r + 6, y: y(v) + 4, class: 'axis' }, `${25 * k}%`));
  }
  svg.append(el('text', { x: m.l - 6, y: 11, class: 'axis', 'text-anchor': 'end' }, 'มม./ชม.'));
  svg.append(el('text', { x: W - m.r + 6, y: 11, class: 'axis' }, 'โอกาส'));

  // เส้นแบ่งวัน + ป้ายวัน
  time.forEach((t, i) => {
    const local = new Date((t + 7 * 3600) * 1000);
    if (local.getUTCHours() === 0) {
      svg.append(el('line', { x1: x(i), x2: x(i), y1: m.t, y2: m.t + ih, class: 'day-line' }));
      svg.append(el('text', { x: x(i) + 3, y: H - 6, class: 'axis' }, dayFmt.format(new Date(t * 1000))));
    } else if (local.getUTCHours() % 6 === 0 && bw * 6 > 28) {
      svg.append(el('text', { x: x(i), y: m.t + ih + 14, class: 'axis small', 'text-anchor': 'middle' }, `${local.getUTCHours()}`));
    }
  });

  // ช่วงระหว่างโมเดล
  time.forEach((t, i) => {
    if (min[i] == null || max[i] == null || max[i] <= 0) return;
    svg.append(el('line', { x1: x(i) + bw / 2, x2: x(i) + bw / 2, y1: y(min[i]), y2: y(max[i]), class: 'range' }));
  });
  // แท่งค่ากลาง
  time.forEach((t, i) => {
    const v = consensus[i];
    if (v == null || v <= 0) return;
    const r = el('rect', {
      x: x(i) + bw * 0.15,
      y: y(v),
      width: Math.max(1, bw * 0.7),
      height: Math.max(0.5, m.t + ih - y(v)),
      class: v >= 20 ? 'bar heavy' : v >= 5 ? 'bar mod' : 'bar',
    });
    r.append(el('title', {}, `${hourFmt.format(new Date(t * 1000))} — ${v.toFixed(1)} มม. (ช่วง ${min[i]?.toFixed(1)}–${max[i]?.toFixed(1)})`));
    svg.append(r);
  });

  // เส้นโอกาสฝน
  if (prob && probTime && prob.length) {
    const idx = new Map(time.map((t, i) => [t, i]));
    const pts = [];
    probTime.forEach((t, k) => {
      const i = idx.get(t);
      if (i == null || prob[k] == null) return;
      pts.push(`${x(i) + bw / 2},${m.t + ih - prob[k] * ih}`);
    });
    if (pts.length > 1) svg.append(el('polyline', { points: pts.join(' '), class: 'prob-line' }));
  }
  container.append(svg);
}

/** แถบความเสี่ยงแบบวงกลม */
export function renderGauge(container, score, color) {
  container.innerHTML = '';
  const r = 52;
  const c = 2 * Math.PI * r;
  const frac = score == null ? 0 : score / 100;
  const svg = el('svg', { viewBox: '0 0 128 128', width: 128, height: 128, class: 'gauge' });
  svg.append(el('circle', { cx: 64, cy: 64, r, class: 'gauge-bg' }));
  svg.append(
    el('circle', {
      cx: 64,
      cy: 64,
      r,
      class: 'gauge-fg',
      stroke: color || 'currentColor',
      'stroke-dasharray': `${c * frac} ${c}`,
      transform: 'rotate(-90 64 64)',
    }),
  );
  svg.append(el('text', { x: 64, y: 70, 'text-anchor': 'middle', class: 'gauge-num' }, score == null ? '–' : String(score)));
  container.append(svg);
}
