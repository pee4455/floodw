// ดึงข้อมูลจากภายนอก (Open-Meteo, RainViewer, ไฟล์ข้อมูลในเว็บ)
// Open-Meteo: ฟรีสำหรับการใช้ที่ไม่ใช่เชิงพาณิชย์ ข้อมูล CC BY 4.0 — https://open-meteo.com/
import { API, FORECAST_MODELS, ENSEMBLE_MODELS, HOURLY_VARS, TIDE_POINT } from './config.js';
import { extractMembers } from './forecast.js';

async function getJSON(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const qs = (o) => new URLSearchParams(o).toString();

/**
 * ดึงพยากรณ์รายโมเดล (ขอทีละโมเดล เพื่อให้โมเดลที่ล่ม/ไม่รองรับไม่ทำให้ทั้งหมดล้ม)
 * @returns {Promise<{model:object, data:object|null, error:string|null}[]>}
 */
export async function fetchModels(loc) {
  const base = {
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: HOURLY_VARS.join(','),
    timezone: 'Asia/Bangkok',
    timeformat: 'unixtime',
    past_days: 3,
    forecast_days: 7,
  };
  return Promise.all(
    FORECAST_MODELS.map(async (model) => {
      try {
        const data = await getJSON(`${API.forecast}?${qs({ ...base, models: model.id })}`);
        const precip = data.hourly?.precipitation;
        if (!precip || precip.every((v) => v == null)) throw new Error('ไม่มีข้อมูลฝน');
        return { model, data, error: null };
      } catch (e) {
        return { model, data: null, error: String(e.message || e) };
      }
    }),
  );
}

/** ดึง ensemble ฝนรายชั่วโมง */
export async function fetchEnsembles(loc) {
  const base = {
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: 'precipitation',
    timezone: 'Asia/Bangkok',
    timeformat: 'unixtime',
    forecast_days: 7,
  };
  return Promise.all(
    ENSEMBLE_MODELS.map(async (model) => {
      try {
        const data = await getJSON(`${API.ensemble}?${qs({ ...base, models: model.id })}`);
        const members = extractMembers(data.hourly, 'precipitation');
        if (members.length < 2) throw new Error('ไม่มีสมาชิก ensemble');
        return { model, time: data.hourly.time, members, error: null };
      } catch (e) {
        return { model, time: [], members: [], error: String(e.message || e) };
      }
    }),
  );
}

/** ระดับน้ำทะเล (รวมน้ำขึ้นน้ำลง) ที่ปากแม่น้ำเจ้าพระยา */
export async function fetchTide() {
  try {
    const data = await getJSON(
      `${API.marine}?${qs({
        latitude: TIDE_POINT.lat,
        longitude: TIDE_POINT.lon,
        hourly: 'sea_level_height_msl',
        timezone: 'Asia/Bangkok',
        timeformat: 'unixtime',
        forecast_days: 3,
      })}`,
    );
    return { time: data.hourly.time, level: data.hourly.sea_level_height_msl, error: null };
  } catch (e) {
    return { time: [], level: [], error: String(e.message || e) };
  }
}

/** เฟรมเรดาร์ฝน RainViewer (ย้อนหลัง ~2 ชม. + nowcast ถ้ามี) */
export async function fetchRadarFrames() {
  const data = await getJSON(API.rainviewer, { timeout: 10000 });
  const frames = [...(data.radar?.past || []), ...(data.radar?.nowcast || [])];
  const nowcastFrom = data.radar?.past?.length ?? frames.length;
  return { host: data.host, frames, nowcastFrom };
}

/** ไฟล์ข้อมูลของแอปเอง (ข่าว/จุดจอดรถ) — กันแคชด้วย timestamp ราย 5 นาที */
export async function fetchLocalData(name) {
  const bust = Math.floor(Date.now() / 300000);
  try {
    return await getJSON(`data/${name}.json?v=${bust}`);
  } catch {
    return null;
  }
}
