/* Shared marker positions. Requires GET/PUT /map-markers on the existing
   Gaileia Visibility Service; local browser saves remain the offline fallback. */
"use strict";
const MARKER_SYNC_ENDPOINT = MAP_VISIBILITY_API + "/map-markers";
const sharedMarkerState = {
  positions: {}, revision: null, ready: false, busy: false, pending: new Map()
};
const sharedMarkerStatus = document.createElement("p");
sharedMarkerStatus.className = "map-access-status";
sharedMarkerStatus.setAttribute("role", "status");
accessBar.append(sharedMarkerStatus);

function markerSyncMessage(message) {
  // Players can see shared positions but do not need editing messages.
  sharedMarkerStatus.textContent = PLAYER_MODE ? "" : message;
}
// Changing back to Player mode immediately clears GM-only sync messages.
accessBar.querySelector('[data-mode="player"]').addEventListener("click", () => markerSyncMessage(""));
function validateSharedPositions(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !payload.positions || typeof payload.positions !== "object" ||
      Array.isArray(payload.positions) ||
      !(payload.revision === null || typeof payload.revision === "string")) {
    throw new Error("Invalid marker positions response");
  }
  const entries = Object.entries(payload.positions);
  if (entries.length > 2000 || !entries.every(([id, point]) =>
    /^[a-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) &&
    id.length <= 96 && validMarkerPosition(point))) {
    throw new Error("Invalid shared marker coordinates");
  }
  return payload;
}
function acceptSharedPositions(payload) {
  const valid = validateSharedPositions(payload);
  sharedMarkerState.positions = valid.positions;
  sharedMarkerState.revision = valid.revision;
  sharedMarkerState.ready = true;
}
function applySharedPositions() {
  // Never move the map underneath a GM who is actively positioning markers.
  if (!PLAYER_MODE && markerEdit.enabled) return;
  for (const marker of markerEdit.markers) {
    const id = marker._positionId;
    const point = sharedMarkerState.positions[id];
    if (!point || sharedMarkerState.pending.has(id)) continue;
    const current = map.project(marker.getLatLng(), maxZoom);
    if (Math.abs(current.x - point.x) > 0.01 || Math.abs(current.y - point.y) > 0.01) {
      marker.setLatLng(px(point.x, point.y));
      // Match local offline fallback to the authoritative shared position.
      saveStoredMarkerPosition(id, point);
      if (marker === partyMarker && mapAccess.activePanel?.key === "panel:party") {
        openPartyPanel();
      }
    }
  }
}
async function fetchSharedPositions() {
  const response = await fetch(MARKER_SYNC_ENDPOINT, {
    cache: "no-store", signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Shared marker service returned " + response.status);
  acceptSharedPositions(await response.json());
  applySharedPositions();
}
async function loadSharedPositions() {
  if (sharedMarkerState.busy) return;
  sharedMarkerState.busy = true;
  try {
    await fetchSharedPositions();
    markerSyncMessage(sharedMarkerState.pending.size ? "Some marker changes still need syncing." : "");
  } catch {
    sharedMarkerState.ready = false;
    markerSyncMessage("Shared marker positions unavailable; local positions remain in this browser.");
  } finally {
    sharedMarkerState.busy = false;
  }
  if (sharedMarkerState.ready && sharedMarkerState.pending.size && !PLAYER_MODE && mapAccess.passcode) {
    void flushSharedPositions();
  }
}
async function flushSharedPositions() {
  if (sharedMarkerState.busy || !sharedMarkerState.ready ||
      PLAYER_MODE || !mapAccess.passcode) return;
  sharedMarkerState.busy = true;
  markerSyncMessage("Saving marker positions for all viewers…");
  try {
    let conflicts = 0;
    while (sharedMarkerState.pending.size && !PLAYER_MODE && mapAccess.passcode) {
      const [key, position] = sharedMarkerState.pending.entries().next().value;
      const response = await fetch(MARKER_SYNC_ENDPOINT, {
        method: "PUT",
        headers: {
          Authorization: "Bearer " + mapAccess.passcode,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ key, position, revision: sharedMarkerState.revision }),
        signal: AbortSignal.timeout(12000)
      });
      if (response.status === 409 && conflicts++ < 2) {
        // Refresh the revision while retaining edits awaiting upload.
        await fetchSharedPositions();
        continue;
      }
      if (!response.ok) throw new Error("Marker save returned " + response.status);
      acceptSharedPositions(await response.json());
      if (sharedMarkerState.pending.get(key) === position) sharedMarkerState.pending.delete(key);
      applySharedPositions();
      conflicts = 0;
    }
    markerSyncMessage(sharedMarkerState.pending.size ?
      "Some marker changes still need syncing." : "Marker locations saved for all viewers.");
  } catch {
    // Position is already safely stored locally for this browser.
    sharedMarkerState.ready = false;
    markerSyncMessage("Could not sync markers. Changes remain saved in this browser.");
  } finally {
    sharedMarkerState.busy = false;
  }
}
function queueSharedMarkerPosition(key, position) {
  if (PLAYER_MODE || !mapAccess.passcode || !validMarkerPosition(position)) return;
  if (!markerEdit.markers || ![...markerEdit.markers].some(m => m._positionId === key)) return;
  sharedMarkerState.pending.set(key, position);
  if (sharedMarkerState.ready) void flushSharedPositions();
  else markerSyncMessage("Saved in this browser; shared sync is currently unavailable.");
}
window.gaileiaSharedMarkerPositions = {
  enqueue: queueSharedMarkerPosition,
  refresh: loadSharedPositions
};
void loadSharedPositions();
setInterval(() => {
  if (!document.hidden) void loadSharedPositions();
}, 20000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void loadSharedPositions();
});
