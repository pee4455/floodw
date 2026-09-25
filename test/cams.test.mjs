import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCameras, canEmbed, watchUrl, embedUrl, nearestCamera, distanceKm } from '../public/js/cams.js';
import { parseWatchPage, cameraState } from '../scripts/lib/youtube.mjs';

const cams = {
  cameras: [
    { id: 'a', type: 'youtube', name: 'A', lat: 13.72, lon: 100.51, videoId: 'AAAAAAAAAAA', channel: null },
    { id: 'b', type: 'youtube', name: 'B', lat: null, lon: null, videoId: null, channel: '@Chan' },
    { id: 'c', type: 'youtube', name: 'C', lat: 13.8, lon: 100.6, videoId: 'CCCCCCCCCCC' },
  ],
};

test('resolveCameras merges status, prefers refreshed live videoId, sorts live first', () => {
  const r = resolveCameras(cams, {
    status: {
      a: { state: 'offline', videoId: 'AAAAAAAAAAA' },
      b: { state: 'live', videoId: 'BBBBBBBBBBB', title: 'Live now' },
      c: { state: 'unavailable', videoId: 'bad id!' },
    },
  });
  assert.deepEqual(r.map((c) => c.id), ['b', 'a', 'c']);
  assert.equal(r[0].videoId, 'BBBBBBBBBBB');
  assert.equal(r[2].videoId, 'CCCCCCCCCCC', 'invalid status id ignored');
  assert.equal(canEmbed(r[2]), false, 'unavailable not embeddable');
  assert.equal(canEmbed(r[1]), true);
});

test('resolveCameras without status marks unknown', () => {
  const r = resolveCameras(cams, null);
  assert.ok(r.every((c) => c.state === 'unknown'));
  assert.equal(canEmbed(r.find((c) => c.id === 'b')), false, 'no video id yet');
});

test('watchUrl falls back to channel live page, rejects odd handles', () => {
  assert.equal(watchUrl({ videoId: 'AAAAAAAAAAA' }), 'https://www.youtube.com/watch?v=AAAAAAAAAAA');
  assert.equal(watchUrl({ videoId: null, channel: '@ThaiPBS' }), 'https://www.youtube.com/@ThaiPBS/live');
  assert.equal(watchUrl({ videoId: null, channel: 'javascript:alert(1)' }), null);
  assert.match(embedUrl('AAAAAAAAAAA'), /^https:\/\/www\.youtube-nocookie\.com\/embed\/AAAAAAAAAAA\?/);
});

test('nearestCamera within radius', () => {
  const r = resolveCameras(cams, null);
  assert.equal(nearestCamera(r, { lat: 13.721, lon: 100.511 }).cam.id, 'a');
  assert.equal(nearestCamera(r, { lat: 14.5, lon: 100.5 }), null);
  assert.ok(Math.abs(distanceKm({ lat: 13.75, lon: 100.5 }, { lat: 13.76, lon: 100.5 }) - 1.11) < 0.01);
});

const page = (extra) =>
  `<html><head><link rel="canonical" href="https://www.youtube.com/watch?v=XYZxyz12345"><meta name="title" content="Bangkok &amp; River"></head>
  <script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},"videoDetails":{${extra}}};</script></html>`;

test('parseWatchPage detects live stream', () => {
  const p = parseWatchPage(page('"isLiveContent":true,"isLiveNow":true'));
  assert.equal(p.videoId, 'XYZxyz12345');
  assert.equal(p.title, 'Bangkok & River');
  assert.equal(cameraState(p), 'live');
});

test('parseWatchPage: ended stream / removed video / channel without live', () => {
  assert.equal(cameraState(parseWatchPage(page('"isLiveContent":true'))), 'offline');
  const removed = parseWatchPage('<link rel="canonical" href="https://www.youtube.com/watch?v=XYZxyz12345">"playabilityStatus":{"status":"ERROR"}');
  assert.equal(cameraState(removed), 'unavailable');
  const channel = parseWatchPage('<link rel="canonical" href="https://www.youtube.com/channel/UCabc">');
  assert.equal(channel.videoId, null);
  assert.equal(cameraState(channel), 'offline');
});
