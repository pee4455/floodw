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
  await page.route(/tile\.openstreetmap\.org|tilecache\.rainviewer\.com|i\.ytimg\.com/, (r) => r.fulfill({ body: PNG_1PX, contentType: 'image/png' }));
  let iticRequests = 0;
  await page.route(/iticfoundation\.org/, (r) => {
    iticRequests++;
    return r.fulfill({ status: 404, body: '' });
  });
  await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ body: '<html><body>player</body></html>', contentType: 'text/html' }));

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

  for (const tab of ['forecast', 'map', 'cams', 'parking', 'news', 'help']) {
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
    if (tab === 'map' && (await page.locator('.cam-marker').count()) === 0) failures.push(`[${label}] ไม่มีหมุดกล้องบนแผนที่`);
    if (tab === 'cams') {
      const cards = await page.locator('.cam-card').count();
      if (cards < 3) failures.push(`[${label}] การ์ดกล้องน้อยผิดปกติ (${cards})`);
      if ((await page.locator('#cam-official li').count()) === 0) failures.push(`[${label}] ไม่มีรายการกล้องทางการ`);
      if (iticRequests) failures.push(`[${label}] โหลดภาพกล้องจราจรเองโดยไม่ได้กด (${iticRequests} ครั้ง)`);
      const traffic = page.locator('.traffic-thumb[data-cam-play]');
      if ((await traffic.count()) > 0) {
        await traffic.first().click();
        await page.waitForTimeout(600);
        if ((await page.locator('#cam-frame video, #cam-frame #cam-snap').count()) === 0) failures.push(`[${label}] กล้องจราจรไม่เปิดตัวเล่น`);
        const st = (await page.textContent('#cam-snap-status'))?.trim();
        if (!st) failures.push(`[${label}] กล้องจราจรไม่มีสถานะ`);
        const hlsBtn = page.locator('[data-cam-mode="hls"]');
        if (await hlsBtn.count()) {
          await hlsBtn.click();
          await page.waitForTimeout(300);
          if ((await page.locator('#cam-frame video').count()) === 0) failures.push(`[${label}] โหมดวิดีโอ HLS ไม่เปิด <video>`);
        }
        await page.click('[data-cam-mode="snap"]');
        await page.waitForTimeout(300);
        if ((await page.locator('#cam-snap').count()) === 0) failures.push(`[${label}] สลับเป็นภาพนิ่งไม่ได้`);
        if (shotDir) await page.screenshot({ path: `${shotDir}/${label}-traffic-dialog.png` });
        await page.click('#cam-dialog-close');
      }
      // กล้องกรมทางหลวง (ตรวจแล้วว่าเล่น HLS ได้) ต้องเปิดเป็นวิดีโอทันที
      await page.fill('#cam-q', 'มีนบุรี');
      await page.waitForTimeout(200);
      const doh = page.locator('.traffic-thumb[data-cam-play]');
      if ((await doh.count()) === 0) failures.push(`[${label}] ค้นหากล้อง "มีนบุรี" ไม่เจอ`);
      else {
        await doh.first().click();
        await page.waitForTimeout(400);
        if ((await page.locator('#cam-frame video').count()) === 0) failures.push(`[${label}] กล้อง HLS ไม่เปิดเป็นวิดีโอ`);
        // กล้องกรมทางหลวงมีปุ่มเลือกทิศทาง (ขาเข้า/ขาออก)
        const dirs = page.locator('[data-cam-stream]');
        if ((await dirs.count()) < 2) failures.push(`[${label}] ไม่มีปุ่มเลือกทิศทางกล้อง`);
        else {
          await dirs.nth(1).click();
          await page.waitForTimeout(300);
          if ((await page.locator('#cam-frame video').count()) === 0) failures.push(`[${label}] สลับทิศทางแล้วไม่มีวิดีโอ`);
        }
        if (shotDir) await page.screenshot({ path: `${shotDir}/${label}-doh-dialog.png` });
        await page.click('#cam-dialog-close');
      }
      await page.fill('#cam-q', '');
      await page.click('#cam-filter button[data-tag="youtube"]');
      await page.locator('.cam-card button[data-cam-play]').first().click();
      await page.waitForTimeout(300);
      const src = await page.getAttribute('#cam-frame iframe', 'src').catch(() => null);
      if (!src || !/youtube-nocookie\.com\/embed\/[\w-]{11}/.test(src)) failures.push(`[${label}] เปิดกล้องไม่ขึ้น iframe (${src})`);
      if (shotDir) await page.screenshot({ path: `${shotDir}/${label}-cam-dialog.png` });
      await page.click('#cam-dialog-close');
      if (await page.locator('#cam-frame iframe').count()) failures.push(`[${label}] ปิดกล้องแล้ววิดีโอยังเล่นอยู่`);
      if (await page.evaluate(() => document.getElementById('cam-dialog').open)) failures.push(`[${label}] dialog ไม่ปิด`);
      await page.click('#cam-filter button[data-tag=""]');
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
