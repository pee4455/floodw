#!/usr/bin/env node
// ตรวจว่ากล้อง YouTube ใน public/data/cameras.json ยังถ่ายทอดสดอยู่ไหม → public/data/camera_status.json
// ถ้ากำหนด channel ไว้ และวิดีโอเดิมไม่ได้ไลฟ์แล้ว จะหาไลฟ์ใหม่ของช่องนั้นให้อัตโนมัติ (videoId ของไลฟ์เปลี่ยนเมื่อสตรีมเริ่มใหม่)
// รันเอง: npm run check-cams
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseWatchPage, cameraState } from './lib/youtube.mjs';

const IN = fileURLToPath(new URL('../public/data/cameras.json', import.meta.url));
const OUT = fileURLToPath(new URL('../public/data/camera_status.json', import.meta.url));

async function fetchPage(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'accept-language': 'en-US,en;q=0.8',
        cookie: 'CONSENT=YES+1',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function check(cam) {
  let page = null;
  if (cam.videoId) page = parseWatchPage(await fetchPage(`https://www.youtube.com/watch?v=${cam.videoId}`));
  if (cam.channel && (!page || cameraState(page) !== 'live')) {
    const ch = parseWatchPage(await fetchPage(`https://www.youtube.com/${cam.channel}/live`));
    if (cameraState(ch) === 'live' || !page) page = ch;
  }
  return {
    state: cameraState(page),
    videoId: page?.videoId || cam.videoId || null,
    title: page?.title || null,
  };
}

async function main() {
  const { cameras } = JSON.parse(await readFile(IN, 'utf8'));
  const yt = cameras.filter((c) => c.type === 'youtube');
  const results = await Promise.allSettled(yt.map(check));
  const status = {};
  let ok = 0;
  results.forEach((r, i) => {
    const cam = yt[i];
    if (r.status === 'fulfilled') {
      ok++;
      status[cam.id] = { ...r.value, checkedAt: new Date().toISOString() };
    } else {
      status[cam.id] = { state: 'unknown', videoId: cam.videoId, error: String(r.reason?.message || r.reason), checkedAt: new Date().toISOString() };
    }
  });
  if (yt.length && ok === 0) {
    console.error('ตรวจกล้องไม่ได้เลยสักตัว — ไม่เขียนทับไฟล์เดิม', status);
    process.exitCode = 1;
    return;
  }
  await writeFile(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), status }, null, 1)}\n`);
  const live = Object.values(status).filter((s) => s.state === 'live').length;
  console.log(`ตรวจ ${yt.length} กล้อง: ไลฟ์ ${live}, สำเร็จ ${ok}/${yt.length} → ${OUT}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
