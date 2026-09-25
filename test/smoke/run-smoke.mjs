#!/usr/bin/env node
// Smoke test: เปิดหน้าเว็บจริงใน Chromium โดยจำลอง API ภายนอก แล้วตรวจว่าไม่มี error และทุกแท็บแสดงผล
// ใช้: npm run smoke   (ตั้ง CHROMIUM_PATH ได้ถ้า Chromium อยู่ที่อื่น; SCREENSHOT_DIR เพื่อบันทึกภาพ)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';
import { startServer } from '../../scripts/serve.mjs';
import { makeForecast, makeEnsemble, makeTide } from '../fixtures.mjs';

const PORT = 8765;
const shotDir = process.env.SCREENSHOT_DIR;
const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(existsSync);
const now = Date.now() / 1000;
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const server = await startServer(PORT);
const browser = await chromium.launch({ executablePath: exe });
const failures = [];

async function run(viewport, label) {
  const page = await browser.newPage({ viewport, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && failures.push(`[${label}] console: ${m.text()}`));
  page.on('pageerror', (e) => failures.push(`[${label}] pageerror: ${e.message}`));

  let n = 0;
  await page.route('https://api.open-meteo.com/**', (r) => {
    // จำลองโมเดลหนึ่งล่ม เพื่อทดสอบว่าหน้าเว็บยังทำงาน
    if (r.request().url().includes('gem_seamless')) return r.fulfill({ status: 500, body: '{}' });
    return r.fulfill({ json: makeForecast(now, 3 + (n++ % 5) * 2) });
  });
  await page.route('https://ensemble-api.open-meteo.com/**', (r) => r.fulfill({ json: makeEnsemble(now, 30, 6) }));
  await page.route('https://marine-api.open-meteo.com/**', (r) => r.fulfill({ json: makeTide(now) }));
  await page.route('https://api.rainviewer.com/**', (r) =>
    r.fulfill({ json: { host: 'https://tilecache.rainviewer.com', radar: { past: [{ time: now - 600, path: '/v2/radar/1' }, { time: now, path: '/v2/radar/2' }], nowcast: [] } } }),
  );
  await page.route(/tile\.openstreetmap\.org|tilecache\.rainviewer\.com/, (r) => r.fulfill({ body: PNG_1PX, contentType: 'image/png' }));

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => /\d/.test(document.getElementById('s-rain24').textContent), null, { timeout: 15000 });
  const check = async (sel, what) => {
    const txt = (await page.textContent(sel))?.trim();
    if (!txt) failures.push(`[${label}] ว่างเปล่า: ${what} (${sel})`);
  };
  await check('#risk-level', 'ระดับความเสี่ยง');
  await check('#sit-headline', 'สถานการณ์');
  await check('#overview-news', 'ข่าวหน้าแรก');
  const status = await page.textContent('#status');
  if (!/บางโมเดล/.test(status)) failures.push(`[${label}] ไม่แจ้งเตือนโมเดลที่ล่ม: "${status}"`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/${label}-overview.png`, fullPage: true });

  for (const tab of ['forecast', 'map', 'parking', 'news', 'help']) {
    await page.click(`.tabs button[data-tab="${tab}"]`);
    await page.waitForTimeout(tab === 'map' ? 800 : 200);
    if (tab === 'forecast') {
      if ((await page.locator('#rain-chart svg rect.bar').count()) === 0) failures.push(`[${label}] กราฟฝนไม่มีแท่ง`);
      if ((await page.locator('#daily-table tbody tr').count()) !== 7) failures.push(`[${label}] ตารางรายวันไม่ครบ 7 วัน`);
    }
    if (tab === 'map') {
      const markers = await page.locator('.leaflet-interactive').count();
      if (markers < 5) failures.push(`[${label}] หมุดบนแผนที่น้อยผิดปกติ (${markers})`);
      await page.check('#lyr-radar');
      await page.waitForTimeout(500);
      const rt = await page.textContent('#radar-time');
      if (!/น\./.test(rt)) failures.push(`[${label}] เรดาร์ไม่แสดงเวลา: "${rt}"`);
    }
    if (tab === 'parking' && (await page.locator('.pcard').count()) === 0) failures.push(`[${label}] ไม่มีการ์ดที่จอดรถ`);
    if (tab === 'news') {
      const all = await page.locator('#news-list li').count();
      await page.click('#news-cats button[data-cat="parking"]');
      const parking = await page.locator('#news-list li').count();
      if (!(all > parking && parking > 0)) failures.push(`[${label}] ตัวกรองข่าวไม่ทำงาน (${all} → ${parking})`);
      await page.click('#news-cats button[data-cat=""]');
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) failures.push(`[${label}] หน้า ${tab} เลื่อนแนวนอนได้ ${overflow}px`);
    if (shotDir) await page.screenshot({ path: `${shotDir}/${label}-${tab}.png`, fullPage: tab !== 'map' });
  }
  await page.close();
}

try {
  if (shotDir) mkdirSync(shotDir, { recursive: true });
  await run({ width: 1280, height: 900 }, 'desktop');
  await run({ width: 390, height: 844 }, 'mobile');
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(`Smoke test ล้มเหลว ${failures.length} รายการ:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Smoke test ผ่าน (desktop + mobile)');
