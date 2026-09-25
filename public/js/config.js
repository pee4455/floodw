// ค่าตั้งต้นของแอป — ปรับน้ำหนักโมเดล/เกณฑ์ได้ที่ไฟล์นี้ที่เดียว
// เหตุผลของค่าต่าง ๆ อธิบายไว้ใน docs/RESEARCH.md

export const DEFAULT_LOCATION = { name: 'กรุงเทพฯ (ศูนย์กลาง)', lat: 13.7563, lon: 100.5018 };

/**
 * โมเดลพยากรณ์แบบ deterministic ที่ใช้ทำ "ค่ากลางหลายโมเดล" (multi-model consensus)
 * ชุดเดียวกับที่เลือกดูได้ใน Windy (ECMWF / GFS / ICON / UKMO ฯลฯ) ดึงผ่าน Open-Meteo
 * weight = น้ำหนักตั้งต้นจากผลประเมินความแม่นยำโมเดลโลกในเขตร้อน (ECMWF สูงสุด)
 * ถ้าโมเดลใดดึงไม่ได้ ระบบจะ normalize น้ำหนักจากโมเดลที่เหลือเอง
 */
export const FORECAST_MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', weight: 0.28, color: '#2563eb' },
  { id: 'ukmo_seamless', label: 'UKMO', weight: 0.18, color: '#7c3aed' },
  { id: 'icon_seamless', label: 'ICON (DWD)', weight: 0.16, color: '#059669' },
  { id: 'gfs_seamless', label: 'GFS (NOAA)', weight: 0.14, color: '#dc2626' },
  { id: 'jma_seamless', label: 'JMA', weight: 0.12, color: '#d97706' },
  { id: 'gem_seamless', label: 'GEM (แคนาดา)', weight: 0.12, color: '#0891b2' },
];

/**
 * ระบบพยากรณ์แบบกลุ่ม (ensemble) ใช้คำนวณ "โอกาส" ของฝนตกหนัก
 * แต่ละระบบได้น้ำหนักเท่ากัน (ไม่ใช่ตามจำนวนสมาชิก) เพื่อไม่ให้ระบบที่มีสมาชิกมากครอบงำ
 */
export const ENSEMBLE_MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF ENS (51)' },
  { id: 'gfs025', label: 'NOAA GEFS (31)' },
  { id: 'icon_seamless', label: 'DWD ICON-EPS (40)' },
];

export const HOURLY_VARS = [
  'precipitation',
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'cloud_cover',
];

/** เกณฑ์ปริมาณฝน 24 ชม. ของกรมอุตุนิยมวิทยา (มม.) */
export const TMD_RAIN_CLASSES = [
  { min: 0.1, label: 'ฝนเล็กน้อย', color: '#93c5fd' },
  { min: 10.1, label: 'ฝนปานกลาง', color: '#3b82f6' },
  { min: 35.1, label: 'ฝนหนัก', color: '#f59e0b' },
  { min: 90.1, label: 'ฝนหนักมาก', color: '#dc2626' },
];

/** ความสามารถระบายน้ำโดยประมาณของท่อระบายน้ำ กทม. (มม./ชม.) */
export const DRAINAGE_CAPACITY_MM_H = 60;

/** จุดปากแม่น้ำเจ้าพระยา ใช้ดูระดับน้ำทะเลหนุน (Open-Meteo Marine API) */
export const TIDE_POINT = { lat: 13.45, lon: 100.58 };

export const API = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  ensemble: 'https://ensemble-api.open-meteo.com/v1/ensemble',
  marine: 'https://marine-api.open-meteo.com/v1/marine',
  rainviewer: 'https://api.rainviewer.com/public/weather-maps.json',
};

export const EMERGENCY_CONTACTS = [
  { name: 'สายด่วน กทม.', phone: '1555', note: 'แจ้งเหตุน้ำท่วม/ขอความช่วยเหลือในกรุงเทพฯ' },
  { name: 'ปภ. (สายด่วนนิรภัย)', phone: '1784', note: 'กรมป้องกันและบรรเทาสาธารณภัย' },
  { name: 'เจ็บป่วยฉุกเฉิน', phone: '1669', note: 'สถาบันการแพทย์ฉุกเฉินแห่งชาติ' },
  { name: 'เหตุด่วนเหตุร้าย', phone: '191', note: 'ตำรวจ' },
  { name: 'ดับเพลิงและกู้ภัย', phone: '199', note: '' },
  { name: 'กรมอุตุนิยมวิทยา', phone: '1182', note: 'สอบถามสภาพอากาศ' },
  { name: 'กรมชลประทาน', phone: '1460', note: 'สถานการณ์น้ำ/เขื่อน' },
  { name: 'การไฟฟ้านครหลวง', phone: '1130', note: 'ไฟฟ้าขัดข้อง/ไฟรั่วช่วงน้ำท่วม' },
];

export const USEFUL_LINKS = [
  { name: 'Traffy Fondue', url: 'https://www.traffy.in.th/', note: 'แจ้งจุดน้ำท่วมขังให้ กทม. โดยตรง' },
  { name: 'เรดาร์ฝน กทม. (สำนักการระบายน้ำ)', url: 'https://weather.bangkok.go.th/', note: 'เรดาร์หนองแขม/หนองจอก ความละเอียดสูง' },
  { name: 'กรมอุตุนิยมวิทยา', url: 'https://www.tmd.go.th/', note: 'ประกาศเตือนภัยทางการ' },
  { name: 'ThaiWater (สสน.)', url: 'https://www.thaiwater.net/', note: 'ระดับน้ำ/ฝนจากสถานีโทรมาตร' },
  { name: 'Windy.com', url: 'https://www.windy.com/?13.756,100.502,9', note: 'เปรียบเทียบโมเดล ECMWF/GFS/ICON' },
  { name: 'GISTDA Disaster', url: 'https://disaster.gistda.or.th/', note: 'ภาพดาวเทียมพื้นที่น้ำท่วม' },
];
