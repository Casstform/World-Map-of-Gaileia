/* GM controls share authentication with the Compendium, but use separate map policy. */
"use strict";
const MAP_VISIBILITY_API = "https://gaileia-visibility-service.casstform.chatgpt.site";
const accessSlug = name => normalize(name).replace(/[^a-z0-9]+/g, "-");
const layerRules = [
  ["Hex Grid", hexesOverlay], ["Natural Features", mapLabelsLayer],
  ["Loom Road", loomRoadOverlay], ["Gaius District Cantons", cantonsOverlay],
  ["Innspiration", innspirationLayer], ["Hometowns", hometownsLayer],
  ["Envoys of the Fall", partyLayer],
  ["Capitals", capitalsLayer, "group:civilization"],
  ["Settlements", settlementsLayer, "group:civilization"],
  ["All Districts", gaileianDistrictOverlay, "group:districts"],
  ["Chaparral", chaparralDistrictOverlay, "group:districts"],
  ["Desert", desertDistrictOverlay, "group:districts"],
  ["Forest", forestDistrictOverlay, "group:districts"],
  ["Gaius", gaiusDistrictOverlay, "group:districts"],
  ["Grassland", grasslandDistrictOverlay, "group:districts"],
  ["Oceanside", oceansideDistrictOverlay, "group:districts"],
  ["Rainforest", rainforestDistrictOverlay, "group:districts"],
  ["Savanna", savannaDistrictOverlay, "group:districts"],
  ["Swamp", swampDistrictOverlay, "group:districts"],
  ["Taiga", taigaDistrictOverlay, "group:districts"],
  ["Tundra", tundraDistrictOverlay, "group:districts"],
  ["Volcanic", volcanicDistrictOverlay, "group:districts"]
].map(([name, layer, group]) => ({ name, layer, group, key: "layer:" + accessSlug(name) }));
layerRules.forEach(rule => mapAccess.layers.set(rule.layer, rule));
mapAccess.layers.set(cantonMarkersLayer, mapAccess.layers.get(cantonsOverlay));
const legendRules = [...layerRules,
  { name: "Districts of Gaileia", key: "group:districts" },
  { name: "Civilization", key: "group:civilization" }
];
const eyeMarkup = visible => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${visible ? "" : '<path d="M3 3 21 21"/>'}</svg>`;
const accessBar = document.createElement("div");
accessBar.className = "map-access";
accessBar.innerHTML = `<div class="map-access-modes" role="group" aria-label="Map viewer mode">
  <button type="button" data-mode="player" aria-pressed="true">Player</button>
  <button type="button" data-mode="gm" aria-pressed="false">GM</button></div>
  <p class="map-access-help" hidden>Eyes control player access</p>
  <p class="map-access-status" role="status">Loading player visibility…</p>`;
layersControl.getContainer().querySelector(".legend-body").prepend(accessBar);
L.DomEvent.disableClickPropagation(accessBar);
const accessStatus = accessBar.querySelector(".map-access-status");
const accessDialog = document.createElement("dialog");
accessDialog.className = "map-access-dialog";
accessDialog.setAttribute("aria-labelledby", "map-access-title");
accessDialog.innerHTML = `<form><h2 id="map-access-title">Unlock GM mode</h2>
  <label for="map-gm-password">GM password</label>
  <input id="map-gm-password" type="password" autocomplete="current-password" required>
  <p class="map-access-error" role="alert"></p>
  <div class="map-access-actions"><button type="button">Cancel</button><button type="submit">Unlock</button></div></form>`;
document.body.append(accessDialog);
const passwordInput = accessDialog.querySelector("input");
const loginError = accessDialog.querySelector(".map-access-error");
let requestGeneration = 0;
let loginGeneration = 0;
function statusMessage(message) { accessStatus.textContent = message; }

function makeEye(key, name, group) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-visibility-eye";
  button.dataset.visibilityKey = key;
  const visible = playerSetting(key);
  const parentHidden = group && !playerSetting(group);
  button.innerHTML = eyeMarkup(visible && !parentHidden);
  const description = parentHidden ? "Hidden by parent group; enable that group first" :
    visible ? "Visible to players — click to make GM-only" : "GM-only — click to reveal to players";
  button.title = `${name}: ${description}`;
  button.setAttribute("aria-label", button.title);
  button.setAttribute("aria-pressed", String(visible && !parentHidden));
  button.disabled = mapAccess.saving || !mapAccess.ready || !!parentHidden;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    void saveMapSetting(key, !playerSetting(key));
  });
  return button;
}

function renderPanelVisibility() {
  const panel = mapAccess.activePanel;
  if (!panel) return;
  const scrollTop = sidePanelBody.scrollTop;
  const template = document.createElement("template");
  template.innerHTML = panel.html;
  // Keep the illustrated header. Unrevealed details are not inserted into the live DOM.
  const hero = template.content.querySelector(".panel-hero");
  sidePanelBody.replaceChildren();
  if (hero) sidePanelBody.append(hero);
  if (!PLAYER_MODE || playerSetting(panel.key)) sidePanelBody.append(template.content);
  sidePanelBody.scrollTop = scrollTop;
  const header = sidePanel.querySelector(".side-panel__header");
  header.querySelector(".map-visibility-eye")?.remove();
  if (!PLAYER_MODE) header.prepend(makeEye(panel.key, "Panel details"));
}

function refreshAccessUI() {
  accessBar.querySelector('[data-mode="player"]').setAttribute("aria-pressed", String(PLAYER_MODE));
  accessBar.querySelector('[data-mode="gm"]').setAttribute("aria-pressed", String(!PLAYER_MODE));
  accessBar.querySelector(".map-access-help").hidden = PLAYER_MODE;
  markerEdit.btn.hidden = PLAYER_MODE;
  markerEdit.btn.disabled = PLAYER_MODE;
  const container = layersControl.getContainer();
  container.querySelectorAll(".map-legend-eye").forEach(el => el.remove());
  container.querySelectorAll(".leaflet-control-layers-overlays label").forEach(label => {
    const rule = legendRules.find(r => r.name === label.textContent.trim());
    if (!rule) return;
    const locked = PLAYER_MODE && (!playerSetting(rule.key) || (rule.group && !playerSetting(rule.group)));
    const input = label.querySelector("input");
    input.disabled = !!locked;
    if (locked) input.checked = false;
    label.classList.toggle("legend-layer-locked", !!locked);
    label.title = locked ? "Not discovered..." : "";
    if (!PLAYER_MODE) {
      const eye = makeEye(rule.key, rule.name, rule.group);
      eye.classList.add("map-legend-eye");
      // Sibling of the label: activating the eye must never toggle its checkbox.
      label.insertAdjacentElement("afterend", eye);
    }
  });
  renderPanelVisibility();
}

function applyMapPolicy() {
  if (PLAYER_MODE) {
    setEditMode(false);
    for (const [layer] of mapAccess.layers) {
      if (!canAccessLayer(layer) && map.hasLayer(layer)) map.removeLayer(layer);
    }
    if (mapAccess.activePanel && panelLockedMarker) {
      const entry = PLACE_INDEX.find(item => item.marker === panelLockedMarker);
      if (entry && !canAccessLayer(entry.layer)) closePanel();
    }
  }
  // Clear previously rendered matches and recompute under the new policy.
  const input = layersControl.getContainer().querySelector(".legend-search-input");
  if (input) input.dispatchEvent(new Event("input"));
  refreshAccessUI();
}
mapAccess.refresh = applyMapPolicy;

// Leaflet rebuilds its own label rows on overlay changes; reattach eyes after each rebuild.
const initiallyVisibleLayers = [...mapAccess.layers.keys()].filter(layer => map.hasLayer(layer));
let initialPolicyLoaded = false;
const originalLayersUpdate = layersControl._update;
layersControl._update = function () {
  const container = this.getContainer();
  const districts = container.querySelector(".districts-nested-control");
  const civilization = container.querySelector(".civilization-nested-control");
  const result = originalLayersUpdate.call(this);
  const overlays = container.querySelector(".leaflet-control-layers-overlays");
  const cantons = [...overlays.querySelectorAll("label")].find(label => label.textContent.trim() === "Gaius District Cantons");
  for (const group of [districts, civilization]) {
    if (group) { if (cantons) cantons.after(group); else overlays.append(group); }
  }
  refreshAccessUI();
  return result;
};
map.on("layeradd", event => {
  if (!canAccessLayer(event.layer)) map.removeLayer(event.layer);
});

function setViewerMode(player) {
  PLAYER_MODE = player;
  if (player) mapAccess.passcode = "";
  map.closePopup();
  applyMapPolicy();
}
accessBar.querySelector('[data-mode="player"]').addEventListener("click", () => setViewerMode(true));
accessBar.querySelector('[data-mode="gm"]').addEventListener("click", () => {
  if (!PLAYER_MODE) return;
  passwordInput.value = "";
  loginError.textContent = "";
  accessDialog.showModal();
  passwordInput.focus();
});
accessDialog.querySelector('button[type="button"]').addEventListener("click", () => accessDialog.close());
accessDialog.addEventListener("close", () => { loginGeneration++; passwordInput.value = ""; });
accessDialog.querySelector("form").addEventListener("submit", async event => {
  event.preventDefault();
  const generation = ++loginGeneration;
  const passcode = passwordInput.value;
  const submit = accessDialog.querySelector('[type="submit"]');
  submit.disabled = true;
  loginError.textContent = "Checking password…";
  try {
    const response = await fetch(`${MAP_VISIBILITY_API}/session`, {
      method: "POST", headers: { Authorization: `Bearer ${passcode}` }, signal: AbortSignal.timeout(12000)
    });
    if (generation !== loginGeneration || !accessDialog.open) return;
    if (!response.ok) throw new Error(response.status === 401 ? "That password did not match." : "GM access is temporarily unavailable.");
    mapAccess.passcode = passcode;
    accessDialog.close();
    setViewerMode(false);
  } catch (error) {
    if (generation === loginGeneration) loginError.textContent = error.name === "TypeError" || error.name === "TimeoutError"
      ? "Cannot reach GM access. Please try again." : error.message;
  } finally { submit.disabled = false; }
});

function acceptPolicy(payload) {
  if (!payload || !payload.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings) ||
      !Object.values(payload.settings).every(value => typeof value === "boolean") ||
      !(payload.revision === null || typeof payload.revision === "string")) throw new Error("Invalid map settings");
  mapAccess.settings = payload.settings;
  mapAccess.revision = payload.revision;
  mapAccess.ready = true;
}
async function loadMapPolicy() {
  if (mapAccess.saving) return;
  const generation = ++requestGeneration;
  try {
    const response = await fetch(`${MAP_VISIBILITY_API}/map-visibility`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("Visibility unavailable");
    const payload = await response.json();
    if (generation !== requestGeneration) return;
    acceptPolicy(payload);
    if (!initialPolicyLoaded) {
      initialPolicyLoaded = true;
      initiallyVisibleLayers.forEach(layer => { if (canAccessLayer(layer)) map.addLayer(layer); });
    }
    statusMessage("");
  } catch {
    if (generation !== requestGeneration) return;
    // Never reveal potentially revoked information from an old local cache.
    mapAccess.ready = false;
    statusMessage("Shared visibility unavailable. Player content stays hidden; retrying…");
  }
  applyMapPolicy();
}
async function saveMapSetting(key, visible) {
  if (PLAYER_MODE || mapAccess.saving || !mapAccess.ready) return;
  mapAccess.saving = true;
  ++requestGeneration;
  refreshAccessUI();
  statusMessage("Saving player visibility…");
  try {
    const response = await fetch(`${MAP_VISIBILITY_API}/map-visibility`, {
      method: "PUT", headers: { Authorization: `Bearer ${mapAccess.passcode}`, "Content-Type": "application/json" },
      body: JSON.stringify({ key, visible, revision: mapAccess.revision }), signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(response.status === 409
      ? "Settings changed in another window. Refreshing; please try again."
      : "Could not save. Checking the shared settings…");
    acceptPolicy(await response.json());
    statusMessage("Saved for all players.");
  } catch (error) {
    // A timed-out write might have succeeded: re-read before allowing another edit.
    mapAccess.ready = false;
    statusMessage(error.message);
    setTimeout(loadMapPolicy, 2000);
  } finally {
    mapAccess.saving = false;
    applyMapPolicy();
  }
}
applyMapPolicy();
void loadMapPolicy();
setInterval(() => { if (!document.hidden) void loadMapPolicy(); }, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadMapPolicy(); });
