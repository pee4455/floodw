// รวมผลโมเดล + ensemble + น้ำทะเลหนุน → ตัวเลขทั้งหมดที่หน้าเว็บใช้ (pure function ทดสอบได้)
import { DRAINAGE_CAPACITY_MM_H, TMD_RAIN_CLASSES } from './config.js';
import {
  blendSeries,
  classifyRain,
  dailyTotals,
  ensembleWindowPercentile,
  exceedanceProbability,
  hourlyEnsembleStats,
  sumWindow,
  weightedMedian,
} from './forecast.js';
import { computeFloodRisk } from './risk.js';

const H = 3600;
const BKK_OFFSET = 7 * H;

/** ระดับความเห็นตรงกันของโมเดล จากช่วงต่ำสุด–สูงสุดเทียบค่ากลาง */
export function agreementLevel(values, consensus) {
  const v = values.filter((x) => x != null);
  if (v.length < 2 || consensus == null) return null;
  const spread = (Math.max(...v) - Math.min(...v)) / (consensus + 5);
  if (spread < 0.6) return { key: 'high', label: 'สูง' };
  if (spread < 1.5) return { key: 'mid', label: 'ปานกลาง' };
  return { key: 'low', label: 'ต่ำ' };
}

/**
 * @param {object} input
 * @param {{model:object, data:object|null}[]} input.models ผลจาก fetchModels
 * @param {{model:object, time:number[], members:number[][]}[]} input.ensembles ผลจาก fetchEnsembles
 * @param {{time:number[], level:number[]}} input.tide
 * @param {number} input.riverAlert 0–3
 * @param {number} input.now unix seconds
 */
export function analyze({ models, ensembles, tide, riverAlert = 0, now }) {
  const hourStart = Math.floor(now / H) * H;
  const ok = models.filter((m) => m.data?.hourly?.time);
  const series = (variable) =>
    ok.map((m) => ({
      id: m.model.id,
      label: m.model.label,
      color: m.model.color,
      weight: m.model.weight,
      time: m.data.hourly.time,
      values: m.data.hourly[variable] || [],
    }));
  const precip = series('precipitation');
  const weights = precip.map((s) => s.weight);
  const ens = (ensembles || []).filter((e) => e.members && e.members.length);

  // ฝนรายชั่วโมงของ Open-Meteo เป็น "ผลรวมของชั่วโมงก่อนหน้า" → ป้ายเวลา t คือฝนช่วง (t-1ชม., t]
  const next = (hFrom, hTo) => [hourStart + hFrom * H + H, hourStart + hTo * H + H];
  const [n24a, n24b] = next(0, 24);
  const perModel = (from, to) => precip.map((s) => sumWindow(s.time, s.values, from, to));

  const rain24Models = perModel(n24a, n24b);
  const rain24 = weightedMedian(rain24Models, weights);
  const rainPast72 = weightedMedian(perModel(hourStart - 71 * H, hourStart + H), weights);
  const rain24P90 = ensembleWindowPercentile(ens, n24a, n24b, 90);
  const probHeavy24 = exceedanceProbability(ens, n24a, n24b, 35);

  const blendP = blendSeries(precip, 'median');
  const blendT = blendSeries(series('temperature_2m'), 'mean');
  const blendFeel = blendSeries(series('apparent_temperature'), 'mean');
  const blendRH = blendSeries(series('relative_humidity_2m'), 'mean');
  const blendWind = blendSeries(series('wind_speed_10m'), 'mean');
  const blendGust = blendSeries(series('wind_gusts_10m'), 'mean');
  const ensStats = hourlyEnsembleStats(ens, 0.5);

  let maxHourlyP90 = null;
  ensStats.time.forEach((t, i) => {
    if (t >= n24a && t < n24b && ensStats.p90[i] != null) maxHourlyP90 = Math.max(maxHourlyP90 ?? 0, ensStats.p90[i]);
  });
  if (maxHourlyP90 == null) {
    blendP.time.forEach((t, i) => {
      if (t >= n24a && t < n24b && blendP.max[i] != null) maxHourlyP90 = Math.max(maxHourlyP90 ?? 0, blendP.max[i]);
    });
  }

  let tideMax = null;
  (tide?.time || []).forEach((t, i) => {
    const v = tide.level[i];
    if (t >= hourStart && t < hourStart + 24 * H && v != null) tideMax = Math.max(tideMax ?? -Infinity, v);
  });

  const risk = computeFloodRisk(
    { rain24Consensus: rain24, rain24P90, probHeavy24, maxHourlyP90, rainPast72, tideMax, riverAlert },
    DRAINAGE_CAPACITY_MM_H,
  );

  // กราฟ 72 ชม.
  const [c0, c1] = next(0, 72);
  const idx72 = blendP.time.map((t, i) => (t >= c0 && t < c1 ? i : -1)).filter((i) => i >= 0);
  const chart = {
    time: idx72.map((i) => blendP.time[i]),
    consensus: idx72.map((i) => blendP.consensus[i]),
    min: idx72.map((i) => blendP.min[i]),
    max: idx72.map((i) => blendP.max[i]),
    probTime: ensStats.time,
    prob: ensStats.prob,
  };

  const at = (blend, t) => {
    const i = blend.time.indexOf(t);
    return i >= 0 ? blend.consensus[i] : null;
  };
  const probAt = (t) => {
    const i = ensStats.time.indexOf(t);
    return i >= 0 ? ensStats.prob[i] : null;
  };
  const nextHours = [1, 2, 3, 4, 5, 6].map((h) => {
    const t = hourStart + h * H;
    return { time: t, rain: at(blendP, t), prob: probAt(t) };
  });
  const current = {
    temp: at(blendT, hourStart),
    feels: at(blendFeel, hourStart),
    rh: at(blendRH, hourStart),
    wind: at(blendWind, hourStart),
    gust: at(blendGust, hourStart),
  };

  // รายวัน (เวลาไทย) — แต่ละโมเดลรวมเป็นยอดรายวันก่อน แล้วค่อยหามัธยฐาน (ไม่ใช่รวมค่ากลางรายชั่วโมง)
  const todayStr = new Date((now + BKK_OFFSET) * 1000).toISOString().slice(0, 10);
  const perModelDaily = precip.map((s) => {
    const d = dailyTotals(s.time.map((t) => t - 1), s.values, BKK_OFFSET);
    return new Map(d.filter((x) => x.hours >= 20).map((x) => [x.day, x.total]));
  });
  const days = [...new Set(perModelDaily.flatMap((m) => [...m.keys()]))].filter((d) => d >= todayStr).sort().slice(0, 7);
  const daily = days.map((day) => {
    const dayStart = Date.parse(`${day}T00:00:00+07:00`) / 1000;
    const totals = perModelDaily.map((m) => (m.has(day) ? m.get(day) : null));
    const consensus = weightedMedian(totals, weights);
    const temps = blendT.time
      .map((t, i) => (t >= dayStart && t < dayStart + 24 * H ? blendT.consensus[i] : null))
      .filter((v) => v != null);
    const [a, b] = [dayStart + H, dayStart + 25 * H];
    return {
      day,
      dayStart,
      totals,
      consensus,
      rainClass: consensus == null ? null : classifyRain(consensus, TMD_RAIN_CLASSES),
      agreement: agreementLevel(totals, consensus),
      p10: exceedanceProbability(ens, a, b, 10),
      p35: exceedanceProbability(ens, a, b, 35),
      p90: exceedanceProbability(ens, a, b, 90),
      tmin: temps.length ? Math.min(...temps) : null,
      tmax: temps.length ? Math.max(...temps) : null,
    };
  });

  return {
    hourStart,
    models: precip.map((s) => ({ id: s.id, label: s.label, color: s.color, weight: s.weight })),
    rain24,
    rain24Class: rain24 == null ? null : classifyRain(rain24, TMD_RAIN_CLASSES),
    rain24Models,
    rain24P90,
    probHeavy24,
    rainPast72,
    maxHourlyP90,
    tideMax,
    risk,
    chart,
    nextHours,
    current,
    daily,
  };
}
