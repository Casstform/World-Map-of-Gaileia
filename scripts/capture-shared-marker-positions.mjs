// Archives the shared-service marker positions without modifying active map settings.
// Invoked by the Archive current Gaileia markers GitHub Actions workflow.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const endpoint = "https://gaileia-visibility-service.casstform.chatgpt.site/map-markers";
const baselinePath = "marker-position-backups/2026-10-15-original.json";
const base = JSON.parse(await readFile(baselinePath, "utf8"));
if (!Array.isArray(base.markers) || base.markers.length !== 32) {
  throw new Error("The original 32-marker reference is missing or invalid");
}

const response = await fetch(endpoint, {
  headers: { Accept: "application/json" },
  signal: AbortSignal.timeout(20000),
  cache: "no-store"
});
if (!response.ok) throw new Error("Shared marker endpoint returned HTTP " + response.status);
const shared = await response.json();
if (!shared || !shared.positions || typeof shared.positions !== "object" ||
    Array.isArray(shared.positions) ||
    !(shared.revision === null || typeof shared.revision === "string")) {
  throw new Error("Unexpected shared marker response format");
}

const validKey = /^[a-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validPoint = point => point && typeof point === "object" &&
  !Array.isArray(point) && Number.isFinite(point.x) && Number.isFinite(point.y) &&
  point.x >= 0 && point.x <= 16384 && point.y >= 0 && point.y <= 16384;
const entries = Object.entries(shared.positions);
if (entries.length > 2000 || !entries.every(([key, point]) =>
  key.length <= 96 && validKey.test(key) && validPoint(point))) {
  throw new Error("Service returned an invalid marker id or coordinate");
}

const recordedAt = new Date().toISOString();
const filename = path.join("marker-position-backups",
  recordedAt.replace(/[:.]/g, "-") + "-shared.json");
const markers = base.markers.map(original => {
  const saved = original.draggable ? shared.positions[original.id] : null;
  return {
    ...original,
    original: { x: original.x, y: original.y },
    atSnapshot: saved ? { x: saved.x, y: saved.y } : { x: original.x, y: original.y },
    positionSource: saved ? "shared-service" : "code-default"
  };
}).map(({ x, y, ...marker }) => marker);

const snapshot = {
  description: "Timestamped record of current published shared positions, with source-code fallbacks",
  recordedAtUtc: recordedAt,
  serviceEndpoint: endpoint,
  serviceRevision: shared.revision,
  coordinateSystem: base.coordinateSystem,
  totalKnownMarkers: markers.length,
  sharedOverrideCount: entries.length,
  sharedOverrides: shared.positions,
  markers
};
await writeFile(filename, JSON.stringify(snapshot, null, 2) + "\n");
console.log("Archived " + markers.length + " marker/label positions ("
  + entries.length + " shared overrides) to " + filename);
