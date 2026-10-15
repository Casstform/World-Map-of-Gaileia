// Run with Node; development dependencies: jsdom@26 and leaflet@1.9.4.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
  url: 'https://casstform.github.io/World-Map-of-Gaileia/', runScripts: 'outside-only', pretendToBeVisual: true
});
const w = dom.window;
// Simulate reopening with saved positions, including the preexisting party key.
w.localStorage.setItem('gaileia.marker.position.v1:capital:morel', JSON.stringify({ x: 5650, y: 9000 }));
w.localStorage.setItem('gaileia.party.pos.v1', JSON.stringify({ x: 7100, y: 7200 }));
w.SVGSVGElement.prototype.createSVGRect = () => ({});
w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
w.AbortSignal.timeout = () => undefined;
let saved = { settings: {}, revision: null };
let shared = { positions: {}, revision: null };
let offline = false;
let calls = [];
w.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (offline) throw new TypeError('offline');
  if (url.endsWith('/session')) return { ok: options.headers.Authorization === 'Bearer test-password', status: 401 };
  if (url.endsWith('/map-markers')) {
    if (options.method === 'PUT') {
      assert.equal(options.headers.Authorization, 'Bearer test-password');
      const body = JSON.parse(options.body);
      if (body.revision !== shared.revision) return { ok: false, status: 409 };
      shared = { positions: { ...shared.positions, [body.key]: body.position }, revision: 'm' + calls.length };
    }
    return { ok: true, json: async () => structuredClone(shared) };
  }
  if (options.method === 'PUT') {
    const body = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer test-password');
    saved = { settings: { ...saved.settings, [body.key]: body.visible }, revision: 'r' + calls.length };
  }
  return { ok: true, json: async () => structuredClone(saved) };
};
w.eval(fs.readFileSync(require.resolve('leaflet/dist/leaflet-src.js'), 'utf8'));
// Run in one script to expose shared top-level bindings in this test environment.
w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1] + '\n' +
  fs.readFileSync(path.join(root, 'map-access.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(root, 'map-marker-sync.js'), 'utf8') + `
window.testMap = { map, mapAccess, layerRules, legendRules, setViewerMode, setEditMode, markerEdit,
  openInnPanel, openPartyPanel, openCantonPanel, CANTON_MARKERS, cantonMarkerByName, sidePanelBody,
  layersControl, settlementsLayer, capitalsLayer, partyLayer, cantonsOverlay, cantonMarkersLayer,
  scoreEntry, PLACE_INDEX, goToPlace, loadMapPolicy, saveMapSetting, acceptPolicy, applyMapPolicy,
  sharedMarkerState, loadSharedPositions };
`);
const t = w.testMap;
const tick = () => new Promise(r => setImmediate(r));
const label = name => [...w.document.querySelectorAll('.leaflet-control-layers-overlays label')].find(x => x.textContent.trim() === name);
(async () => {
  await tick();
  assert.equal(t.mapAccess.ready, true);
  assert.equal(w.document.querySelector('.map-access-dialog form').textContent.includes('Use your Gaileia Compendium password.'), false);
  const point = marker => t.map.project(marker.getLatLng(), 6);
  const morel = t.PLACE_INDEX.find(x => x.name === 'Morel' && x.tag === 'Capital');
  const partyEntry = t.PLACE_INDEX.find(x => x.tag === 'Party');
  assert(Math.abs(point(morel.marker).x - 5650) < 0.01);
  assert(Math.abs(point(partyEntry.marker).y - 7200) < 0.01);
  assert.equal(t.markerEdit.btn.hidden, true);
  assert.equal(label('Settlements').querySelector('input').disabled, true);
  assert.equal(label('Settlements').title, 'Not discovered...');
  t.setEditMode(true);
  assert.equal(t.markerEdit.enabled, false);
  const settlement = t.PLACE_INDEX.find(x => x.tag === 'Settlement');
  assert.equal(t.scoreEntry(settlement, settlement.n), 0);
  t.goToPlace(settlement);
  assert.equal(t.map.hasLayer(t.settlementsLayer), false);
  t.openInnPanel();
  assert(t.sidePanelBody.querySelector('.panel-hero'));
  assert(!t.sidePanelBody.textContent.includes('Description'));
  t.openPartyPanel();
  assert(!t.sidePanelBody.textContent.includes('Party Members'));
  const canton = t.CANTON_MARKERS.find(x => x.name === 'Hie Porta');
  t.openCantonPanel(canton, t.cantonMarkerByName[canton.name]);
  assert.equal(t.sidePanelBody.querySelectorAll('img').length, 1);
  // Wrong and correct password through the actual form handler.
  w.document.querySelector('[data-mode="gm"]').click();
  w.document.querySelector('#map-gm-password').value = 'wrong';
  w.document.querySelector('.map-access-dialog form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick();
  assert.equal(t.markerEdit.btn.hidden, true);
  assert.match(w.document.querySelector('.map-access-error').textContent, /did not match/);
  w.document.querySelector('#map-gm-password').value = 'test-password';
  w.document.querySelector('.map-access-dialog form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await tick();
  assert.equal(t.markerEdit.btn.hidden, false);
  assert.equal(label('Settlements').querySelector('input').disabled, false);
  assert(t.scoreEntry(settlement, settlement.n) > 0);
  assert.equal(t.sidePanelBody.querySelectorAll('img').length, 2);
  t.setEditMode(true);
  assert.equal(t.markerEdit.enabled, true);
  // Drags persist independently across marker types and never collide on shared names.
  const hometownOceanside = t.PLACE_INDEX.find(x => x.name === 'Oceanside' && x.tag === 'Hometown');
  const capitalOceanside = t.PLACE_INDEX.find(x => x.name === 'Oceanside' && x.tag === 'Capital');
  const innEntry = t.PLACE_INDEX.find(x => x.name === 'Innspiration');
  const destinations = [
    [morel.marker, 'capital:morel', 5700, 9100],
    [partyEntry.marker, 'party:envoys-of-the-fall', 7200, 7300],
    [innEntry.marker, 'guild:innspiration', 7050, 7250],
    [hometownOceanside.marker, 'hometown:oceanside', 9800, 2300],
    [capitalOceanside.marker, 'capital:oceanside', 9900, 2400],
    [settlement.marker, 'settlement:manikant', 7000, 8950]
  ];
  for (const [marker, key, x, y] of destinations) {
    marker.setLatLng(t.map.unproject([x, y], 6));
    marker.fire('dragend');
    const persisted = JSON.parse(w.localStorage.getItem('gaileia.marker.position.v1:' + key));
    assert(Math.abs(persisted.x - x) < 0.01);
    assert(Math.abs(persisted.y - y) < 0.01);
  }
  // Uploads are authenticated; simulate a fresh browser with no local storage.
  await tick();
  assert.equal(shared.positions['party:envoys-of-the-fall'].x, 7200);
  assert.equal(shared.positions['guild:innspiration'].x, 7050);
  w.localStorage.removeItem('gaileia.marker.position.v1:party:envoys-of-the-fall');
  partyEntry.marker.setLatLng(t.map.unproject([1000, 1000], 6));
  t.setEditMode(false);
  await t.loadSharedPositions();
  assert(Math.abs(point(partyEntry.marker).x - 7200) < 0.01);
  // Leaflet updates must preserve nested groups and eye controls.
  t.map.addLayer(t.cantonsOverlay);
  t.map.removeLayer(t.cantonsOverlay);
  assert(label('Settlements'));
  assert(label('Chaparral'));
  assert.equal(w.document.querySelectorAll('.map-legend-eye').length, t.legendRules.length);
  t.openInnPanel();
  assert(t.sidePanelBody.textContent.includes('Description'));
  w.document.querySelector('.side-panel__header .map-visibility-eye').click();
  await tick();
  assert.equal(saved.settings['panel:innspiration'], true);
  // Revealing panel details must not reveal any other panel.
  t.setViewerMode(true);
  assert.equal(t.markerEdit.enabled, false);
  const beforePlayerDrag = w.localStorage.getItem('gaileia.marker.position.v1:capital:morel');
  morel.marker.setLatLng(t.map.unproject([6000, 9200], 6));
  morel.marker.fire('dragend');
  assert.equal(w.localStorage.getItem('gaileia.marker.position.v1:capital:morel'), beforePlayerDrag);
  assert.equal(shared.positions['capital:morel'].x, 5700);
  assert(t.sidePanelBody.textContent.includes('Description'));
  t.openPartyPanel();
  assert(!t.sidePanelBody.textContent.includes('Party Members'));
  t.openCantonPanel(canton, t.cantonMarkerByName[canton.name]);
  assert.equal(t.sidePanelBody.querySelectorAll('img').length, 1);
  assert.equal(w.document.querySelectorAll('.map-visibility-eye').length, 0);
  // Simulate another device changing shared policy, then revoking it.
  saved.settings['layer:settlements'] = true;
  await t.loadMapPolicy();
  assert.equal(label('Settlements').querySelector('input').disabled, false);
  t.goToPlace(settlement);
  assert.equal(t.map.hasLayer(t.settlementsLayer), true);
  saved.settings['layer:settlements'] = false;
  await t.loadMapPolicy();
  assert.equal(t.map.hasLayer(t.settlementsLayer), false);
  assert.equal(t.scoreEntry(settlement, settlement.n), 0);
  // Group restriction also blocks child layers and direct navigation.
  saved.settings['group:civilization'] = false;
  await t.loadMapPolicy();
  assert.equal(label('Capitals').querySelector('input').disabled, true);
  const capital = t.PLACE_INDEX.find(x => x.tag === 'Capital');
  t.goToPlace(capital);
  assert.equal(t.map.hasLayer(t.capitalsLayer), false);
  // Fail closed even if a prior session had revealed details.
  offline = true;
  await t.loadMapPolicy();
  t.openInnPanel();
  assert(!t.sidePanelBody.textContent.includes('Description'));
  assert.equal(t.mapAccess.ready, false);
  assert.equal(label('Hometowns').querySelector('input').disabled, true);
  console.log('Map DOM integration tests passed: authentication, cross-browser marker sync, persisted marker positions, panel isolation, legend rebuilds, search, drag locking, shared refresh and fail-closed policy.');
  w.close();
})().catch(error => { console.error(error); w.close(); process.exitCode = 1; });
