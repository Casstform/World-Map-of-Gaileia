// Integration test: two independent DOM/browser storage contexts against the real Worker.
// GAILEIA_SERVICE_WORKER must point to the Gaileia Visibility Service worker/index.js.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1] + '\n' +
  fs.readFileSync(path.join(root, 'map-access.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'map-marker-sync.js'), 'utf8') + `
window.testMap = { map, mapAccess, markerEdit, setViewerMode, setEditMode, partyMarker, innMarker,
  loadSharedPositions, sharedMarkerState, flushSharedPositions };`;
const tick = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 10)); }
const contexts = [];
(async () => {
  assert(process.env.GAILEIA_SERVICE_WORKER, 'Set GAILEIA_SERVICE_WORKER to the service source');
  const { default: worker } = await import(pathToFileURL(path.resolve(process.env.GAILEIA_SERVICE_WORKER)));
  const objects = new Map();
  let revision = 0;
  const password = 'isolated-test-password';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))).toString('hex');
  const env = { GM_PASSCODE_SHA256: hash, ALLOWED_ORIGIN: 'https://casstform.github.io', BUCKET: {
    async get(key) { const entry = objects.get(key); return entry ? { etag: entry.etag, text: async () => entry.text } : null; },
    async put(key, text, options = {}) {
      const entry = objects.get(key);
      if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== entry?.etag) return null;
      if (options.onlyIf?.etagDoesNotMatch === '*' && entry) return null;
      const etag = String(++revision);
      objects.set(key, { text, etag });
      return { etag };
    }
  } };
  function browser(storage = {}) {
    const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
      url: 'https://casstform.github.io/World-Map-of-Gaileia/', runScripts: 'outside-only', pretendToBeVisual: true
    });
    contexts.push(dom);
    const w = dom.window;
    const network = { offline: false, puts: 0 };
    Object.entries(storage).forEach(([key, value]) => w.localStorage.setItem(key, value));
    w.SVGSVGElement.prototype.createSVGRect = () => ({});
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
    w.AbortSignal.timeout = () => undefined;
    w.fetch = async (url, options = {}) => {
      if (network.offline) throw new TypeError('offline');
      if (options.method === 'PUT') network.puts++;
      return worker.fetch(new Request(url, { ...options, headers: {
        Origin: env.ALLOWED_ORIGIN, ...options.headers
      } }), env);
    };
    w.eval(fs.readFileSync(require.resolve('leaflet/dist/leaflet-src.js'), 'utf8'));
    w.eval(code);
    return { w, t: w.testMap, network, close: () => w.close() };
  }
  async function login(b) {
    b.w.document.querySelector('[data-mode="gm"]').click();
    b.w.document.querySelector('#map-gm-password').value = password;
    b.w.document.querySelector('.map-access-dialog form').dispatchEvent(new b.w.Event('submit', { cancelable: true }));
    await settle();
    assert.equal(b.t.markerEdit.btn.hidden, false);
  }
  const point = (b, marker = b.t.partyMarker) => b.t.map.project(marker.getLatLng(), 6);
  function drag(b, marker, x, y) {
    b.t.setEditMode(true);
    marker.setLatLng(b.t.map.unproject([x, y], 6));
    marker.fire('dragend');
  }
  let home = browser();
  await settle();
  await login(home);
  drag(home, home.t.partyMarker, 7500, 7600);
  await settle();
  assert.equal(home.t.sharedMarkerState.pending.size, 0);
  assert.match(home.w.document.body.textContent, /Marker locations saved for all viewers/);
  const gameDay = browser();
  await settle();
  assert.equal(gameDay.t.markerEdit.btn.hidden, true);
  assert.equal(point(gameDay).x, 7500);
  assert.equal(point(gameDay).y, 7600);
  assert.equal(gameDay.network.puts, 0);
  // A second GM with a stale revision must refresh and preserve both marker edits.
  await login(gameDay);
  drag(home, home.t.partyMarker, 7800, 7900);
  await settle();
  drag(gameDay, gameDay.t.innMarker, 7000, 7400);
  await settle();
  gameDay.t.setViewerMode(true);
  await gameDay.t.loadSharedPositions();
  assert.equal(point(gameDay).x, 7800);
  assert.equal(point(gameDay, gameDay.t.innMarker).x, 7000);
  // An offline move survives closing/reopening; it publishes only after GM login.
  home.network.offline = true;
  drag(home, home.t.partyMarker, 8100, 8200);
  await settle();
  assert.equal(home.t.sharedMarkerState.pending.size, 1);
  const storage = Object.fromEntries(Object.keys(home.w.localStorage).map(key => [key, home.w.localStorage.getItem(key)]));
  assert(storage['gaileia.marker.pending.v1'].includes('8100'));
  home.close();
  home = browser(storage);
  await settle();
  assert.equal(home.network.puts, 0);
  assert.equal(home.t.sharedMarkerState.pending.size, 1);
  await login(home);
  await settle();
  assert.equal(home.t.sharedMarkerState.pending.size, 0);
  assert.equal(home.w.localStorage.getItem('gaileia.marker.pending.v1'), '[]');
  await gameDay.t.loadSharedPositions();
  assert.equal(point(gameDay).x, 8100);
  assert.equal(point(gameDay).y, 8200);
  // Reopening a clean browser receives the authoritative server coordinates.
  const fresh = browser();
  await settle();
  assert.equal(point(fresh).x, 8100);
  assert.equal(point(fresh, fresh.t.innMarker).x, 7000);
  assert.equal(fresh.network.puts, 0);
  console.log('Independent browser-context integration passed against the real Worker: GM save, player read, fresh visit, concurrent edits and offline reload/retry.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => contexts.forEach(dom => dom.window.close()));
