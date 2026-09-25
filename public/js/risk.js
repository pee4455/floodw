// ดัชนีความเสี่ยงน้ำท่วมขังกรุงเทพฯ (heuristic 0–100)
// ไม่ใช่ประกาศทางการ — รวมปัจจัยที่ทำให้กรุงเทพฯ ท่วมขังให้อ่านง่ายในตัวเลขเดียว
// รายละเอียดเหตุผลแต่ละปัจจัยอยู่ใน docs/RESEARCH.md

export const RISK_LEVELS = [
  { min: 0, key: 'low', label: 'ต่ำ', color: '#16a34a', advice: 'สถานการณ์ปกติ ติดตามข่าวสารตามปกติ' },
  { min: 25, key: 'watch', label: 'เฝ้าระวัง', color: '#ca8a04', advice: 'มีโอกาสฝนหนักเป็นช่วง ๆ เลี่ยงจุดท่วมซ้ำซาก เผื่อเวลาเดินทาง' },
  { min: 50, key: 'high', label: 'สูง', color: '#ea580c', advice: 'เตรียมย้ายรถไปที่สูง ยกของขึ้นที่สูง ติดตามประกาศ กทม./กรมอุตุฯ ใกล้ชิด' },
  { min: 75, key: 'severe', label: 'วิกฤต', color: '#dc2626', advice: 'หลีกเลี่ยงการเดินทาง ย้ายรถ/ทรัพย์สินทันที เตรียมถุงยังชีพและเบอร์ฉุกเฉิน' },
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * @param {object} p
 * @param {number|null} p.rain24Consensus ฝนรวม 24 ชม. ข้างหน้า (ค่ากลางหลายโมเดล) มม.
 * @param {number|null} p.rain24P90 ฝนรวม 24 ชม. กรณีหนัก (P90 ของ ensemble) มม.
 * @param {number|null} p.probHeavy24 โอกาสฝน ≥ 35 มม./24 ชม. (0–1)
 * @param {number|null} p.maxHourlyP90 ฝนรายชั่วโมงสูงสุดกรณีหนัก (P90) มม./ชม.
 * @param {number|null} p.rainPast72 ฝนสะสม 3 วันที่ผ่านมา มม.
 * @param {number|null} p.tideMax ระดับน้ำทะเลหนุนสูงสุด 24 ชม. (ม. เทียบ MSL)
 * @param {number} p.riverAlert ระดับเตือนแม่น้ำเจ้าพระยาจากประกาศทางการ 0–3 (ตั้งใน data/curated.json)
 * @param {number} drainageCapacity มม./ชม.
 */
export function computeFloodRisk(p, drainageCapacity = 60) {
  const rainHeavy = p.rain24P90 ?? p.rain24Consensus;
  const factors = [
    {
      key: 'rain',
      label: 'ปริมาณฝน 24 ชม. ข้างหน้า (กรณีหนัก P90)',
      max: 35,
      value: rainHeavy == null ? null : clamp01(rainHeavy / 90) * 35,
      detail: rainHeavy == null ? 'ไม่มีข้อมูล' : `${rainHeavy.toFixed(0)} มม. (เกณฑ์ฝนหนักมาก 90 มม.)`,
    },
    {
      key: 'intensity',
      label: 'ความแรงฝนรายชั่วโมง เทียบความสามารถระบายน้ำ',
      max: 15,
      value: p.maxHourlyP90 == null ? null : clamp01(p.maxHourlyP90 / (drainageCapacity * 0.5)) * 15,
      detail:
        p.maxHourlyP90 == null
          ? 'ไม่มีข้อมูล'
          : `สูงสุด ~${p.maxHourlyP90.toFixed(0)} มม./ชม. (ท่อระบาย ~${drainageCapacity} มม./ชม.; โมเดลโลกมักประเมินฝนพายุฟ้าคะนองต่ำกว่าจริง)`,
    },
    {
      key: 'prob',
      label: 'โอกาสฝนหนัก (≥35 มม./วัน) จาก ensemble',
      max: 15,
      value: p.probHeavy24 == null ? null : p.probHeavy24 * 15,
      detail: p.probHeavy24 == null ? 'ไม่มีข้อมูล' : `${Math.round(p.probHeavy24 * 100)}%`,
    },
    {
      key: 'antecedent',
      label: 'ฝนสะสม 3 วันก่อนหน้า (ดิน/คลองอิ่มน้ำ)',
      max: 15,
      value: p.rainPast72 == null ? null : clamp01(p.rainPast72 / 120) * 15,
      detail: p.rainPast72 == null ? 'ไม่มีข้อมูล' : `${p.rainPast72.toFixed(0)} มม.`,
    },
    {
      key: 'tide',
      label: 'น้ำทะเลหนุนปากอ่าว',
      max: 10,
      value: p.tideMax == null ? null : clamp01((p.tideMax - 0.3) / 0.9) * 10,
      detail: p.tideMax == null ? 'ไม่มีข้อมูล' : `สูงสุด ${p.tideMax.toFixed(2)} ม. (MSL)`,
    },
    {
      key: 'river',
      label: 'ระดับน้ำเจ้าพระยา/น้ำเหนือ (จากประกาศทางการ)',
      max: 10,
      value: (clamp01((p.riverAlert ?? 0) / 3)) * 10,
      detail: ['ปกติ', 'เฝ้าระวัง', 'เตือนภัย', 'วิกฤต'][Math.max(0, Math.min(3, p.riverAlert ?? 0))],
    },
  ];
  // ปัจจัยที่ไม่มีข้อมูล: ขยายคะแนนจากปัจจัยที่มี (ไม่ลงโทษ/ไม่ให้คะแนนฟรี)
  const known = factors.filter((f) => f.value != null);
  const knownMax = known.reduce((s, f) => s + f.max, 0);
  const raw = known.reduce((s, f) => s + f.value, 0);
  const score = knownMax > 0 ? Math.round((raw / knownMax) * 100) : null;
  const level = score == null ? null : [...RISK_LEVELS].reverse().find((l) => score >= l.min);
  return { score, level, factors, coverage: knownMax / 100 };
}
