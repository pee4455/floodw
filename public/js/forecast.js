// ฟังก์ชันคำนวณพยากรณ์ (pure — ไม่มี I/O) ทดสอบได้ด้วย node --test

/** ค่าเฉลี่ยถ่วงน้ำหนัก ข้ามค่าที่เป็น null */
export function weightedMean(values, weights) {
  let sum = 0;
  let wsum = 0;
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) return;
    sum += v * weights[i];
    wsum += weights[i];
  });
  return wsum > 0 ? sum / wsum : null;
}

/**
 * มัธยฐานถ่วงน้ำหนัก — ทนต่อโมเดลที่ "หลุด" (outlier) ได้ดีกว่าค่าเฉลี่ย
 * เหมาะกับฝนซึ่งมีการแจกแจงเบ้มาก (ส่วนใหญ่ 0 มีบางโมเดลตกหนัก)
 */
export function weightedMedian(values, weights) {
  const pairs = values
    .map((v, i) => [v, weights[i]])
    .filter(([v, w]) => v != null && !Number.isNaN(v) && w > 0)
    .sort((a, b) => a[0] - b[0]);
  if (pairs.length === 0) return null;
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  for (let i = 0; i < pairs.length; i++) {
    acc += pairs[i][1];
    if (acc > total / 2) return pairs[i][0];
    if (acc === total / 2) return (pairs[i][0] + pairs[i + 1][0]) / 2;
  }
  return pairs[pairs.length - 1][0];
}

/** percentile แบบ linear interpolation (p: 0–100) */
export function percentile(values, p) {
  const v = values.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = (p / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

/**
 * รวมผลหลายโมเดลให้อยู่บนแกนเวลาเดียวกัน
 * @param {{id:string, weight:number, time:number[], values:(number|null)[]}[]} series
 * @param {'median'|'mean'} method
 * @returns {{time:number[], consensus:(number|null)[], min:(number|null)[], max:(number|null)[], agree:(number|null)[]}}
 */
export function blendSeries(series, method = 'median') {
  const ok = series.filter((s) => s && s.time && s.time.length);
  if (ok.length === 0) return { time: [], consensus: [], min: [], max: [], agree: [] };
  const time = [...new Set(ok.flatMap((s) => s.time))].sort((a, b) => a - b);
  const lookups = ok.map((s) => {
    const m = new Map();
    s.time.forEach((t, i) => m.set(t, s.values[i]));
    return m;
  });
  const weights = ok.map((s) => s.weight ?? 1);
  const consensus = [];
  const min = [];
  const max = [];
  const agree = [];
  for (const t of time) {
    const vals = lookups.map((m) => (m.has(t) ? m.get(t) : null));
    const present = vals.filter((v) => v != null);
    consensus.push(method === 'mean' ? weightedMean(vals, weights) : weightedMedian(vals, weights));
    min.push(present.length ? Math.min(...present) : null);
    max.push(present.length ? Math.max(...present) : null);
    agree.push(present.length);
  }
  return { time, consensus, min, max, agree };
}

/**
 * รวมค่าฝนรายชั่วโมงเป็นรายวัน (ตามเวลาท้องถิ่น)
 * @param {number[]} time unix seconds
 * @param {(number|null)[]} values
 * @param {number} utcOffsetSeconds
 * @returns {{day:string, total:number, hours:number}[]}
 */
export function dailyTotals(time, values, utcOffsetSeconds = 7 * 3600) {
  const out = new Map();
  time.forEach((t, i) => {
    const day = new Date((t + utcOffsetSeconds) * 1000).toISOString().slice(0, 10);
    const cur = out.get(day) || { day, total: 0, hours: 0 };
    if (values[i] != null) {
      cur.total += values[i];
      cur.hours += 1;
    }
    out.set(day, cur);
  });
  return [...out.values()];
}

/** ผลรวมในช่วงเวลา [from, to) (unix seconds) */
export function sumWindow(time, values, from, to) {
  let s = 0;
  time.forEach((t, i) => {
    if (t >= from && t < to && values[i] != null) s += values[i];
  });
  return s;
}

/**
 * ความน่าจะเป็นจาก ensemble
 * แต่ละระบบ ensemble ได้น้ำหนักเท่ากัน: P = เฉลี่ย( สัดส่วนสมาชิกที่ผ่านเกณฑ์ ของแต่ละระบบ )
 * @param {{time:number[], members:(number|null)[][]}[]} systems
 * @param {number} from unix seconds (รวม)
 * @param {number} to unix seconds (ไม่รวม)
 * @param {number} threshold ผลรวมฝนในช่วงเวลา (มม.) ที่ถือว่า "เกิน"
 * @returns {number|null} 0–1
 */
export function exceedanceProbability(systems, from, to, threshold) {
  const probs = [];
  for (const sys of systems) {
    if (!sys || !sys.members || sys.members.length === 0) continue;
    const idx = [];
    sys.time.forEach((t, i) => {
      if (t >= from && t < to) idx.push(i);
    });
    if (idx.length === 0) continue;
    let hit = 0;
    let n = 0;
    for (const m of sys.members) {
      const vals = idx.map((i) => m[i]).filter((v) => v != null);
      if (vals.length === 0) continue;
      n++;
      if (vals.reduce((a, b) => a + b, 0) >= threshold) hit++;
    }
    if (n > 0) probs.push(hit / n);
  }
  if (probs.length === 0) return null;
  return probs.reduce((a, b) => a + b, 0) / probs.length;
}

/**
 * โอกาสฝนตกรายชั่วโมง (≥ threshold มม./ชม.) และ P90 ของปริมาณฝนรายชั่วโมง จากทุกระบบ
 * @returns {{time:number[], prob:(number|null)[], p90:(number|null)[]}}
 */
export function hourlyEnsembleStats(systems, threshold = 0.5) {
  const ok = systems.filter((s) => s && s.members && s.members.length);
  const time = [...new Set(ok.flatMap((s) => s.time))].sort((a, b) => a - b);
  const idxMaps = ok.map((s) => new Map(s.time.map((t, i) => [t, i])));
  const prob = [];
  const p90 = [];
  for (const t of time) {
    const fracs = [];
    const all = [];
    ok.forEach((s, k) => {
      const i = idxMaps[k].get(t);
      if (i == null) return;
      const vals = s.members.map((m) => m[i]).filter((v) => v != null);
      if (vals.length === 0) return;
      fracs.push(vals.filter((v) => v >= threshold).length / vals.length);
      all.push(percentile(vals, 90));
    });
    prob.push(fracs.length ? fracs.reduce((a, b) => a + b, 0) / fracs.length : null);
    p90.push(all.length ? all.reduce((a, b) => a + b, 0) / all.length : null);
  }
  return { time, prob, p90 };
}

/**
 * รวมสมาชิก ensemble ในช่วงเวลา แล้วคืน percentile ของ "ผลรวม" (เช่น P90 ของฝน 24 ชม.)
 * แต่ละระบบคำนวณแยก แล้วเฉลี่ย
 */
export function ensembleWindowPercentile(systems, from, to, p) {
  const out = [];
  for (const sys of systems) {
    if (!sys || !sys.members || sys.members.length === 0) continue;
    const totals = sys.members.map((m) => {
      let s = 0;
      let n = 0;
      sys.time.forEach((t, i) => {
        if (t >= from && t < to && m[i] != null) {
          s += m[i];
          n++;
        }
      });
      return n ? s : null;
    });
    const v = percentile(totals, p);
    if (v != null) out.push(v);
  }
  return out.length ? out.reduce((a, b) => a + b, 0) / out.length : null;
}

/** ดึง "สมาชิก" ทั้งหมดของตัวแปรหนึ่งจาก response ของ Open-Meteo Ensemble API */
export function extractMembers(hourly, variable = 'precipitation') {
  if (!hourly) return [];
  return Object.keys(hourly)
    .filter((k) => k === variable || k.startsWith(`${variable}_member`))
    .map((k) => hourly[k]);
}

/** จัดระดับฝนตามเกณฑ์กรมอุตุฯ */
export function classifyRain(mm24, classes) {
  let cls = null;
  for (const c of classes) if (mm24 >= c.min) cls = c;
  return cls;
}
