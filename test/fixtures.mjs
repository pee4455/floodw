// ข้อมูลจำลองรูปแบบเดียวกับ Open-Meteo (ใช้ทั้ง unit test และ smoke test)
const H = 3600;

/** ฝนจำลอง: ฝนฟ้าคะนองช่วงบ่าย–ค่ำ (15:00–20:00 น.) ตามรูปแบบฤดูฝนกรุงเทพฯ */
function rainAt(t, scale) {
  const hourBkk = new Date((t + 7 * H) * 1000).getUTCHours();
  return hourBkk >= 15 && hourBkk <= 20 ? +(scale * (1 + Math.sin(hourBkk))).toFixed(1) : 0;
}

export function makeTimes(now, pastDays = 3, days = 7) {
  const start = Math.floor((now + 7 * H) / 86400) * 86400 - 7 * H - pastDays * 86400;
  return Array.from({ length: (pastDays + days) * 24 }, (_, i) => start + i * H);
}

export function makeForecast(now, scale = 5) {
  const time = makeTimes(now);
  return {
    utc_offset_seconds: 25200,
    hourly: {
      time,
      precipitation: time.map((t) => rainAt(t, scale)),
      temperature_2m: time.map((t) => 27 + 5 * Math.sin(((t / H) % 24) / 24 * 2 * Math.PI)),
      apparent_temperature: time.map(() => 36),
      relative_humidity_2m: time.map(() => 80),
      wind_speed_10m: time.map(() => 12),
      wind_gusts_10m: time.map(() => 25),
      cloud_cover: time.map(() => 70),
    },
  };
}

export function makeEnsemble(now, members = 10, scale = 5) {
  const time = makeTimes(now, 0, 7);
  const hourly = { time };
  for (let m = 0; m < members; m++) {
    const k = m === 0 ? 'precipitation' : `precipitation_member${String(m).padStart(2, '0')}`;
    hourly[k] = time.map((t) => rainAt(t, scale * (0.3 + (1.5 * m) / members)));
  }
  return { hourly };
}

export function makeTide(now) {
  const time = makeTimes(now, 0, 3);
  return { hourly: { time, sea_level_height_msl: time.map((t) => 0.8 * Math.sin((t / H / 12.42) * 2 * Math.PI)) } };
}
