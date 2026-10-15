# GM and player visibility

The Legend starts in Player mode on every page load. Select GM and enter the same password used by the Gaileia Compendium. Returning to Player clears the in-memory password; it is never stored in browser storage.

In GM mode, eye buttons beside overlay layers and the Districts/Civilization groups set player access. An open eye permits players to use that layer; a crossed-out eye makes it GM-only. A closed parent group takes precedence over its children. These choices do not change the GM's layer checkbox selections. Base maps and navigation tools remain available to players.

Restricted layers are disabled with the tooltip `Not discovered...`, removed from the player map, and excluded from search. Drag Markers is always GM-only, including its E shortcut. In Player mode its button is removed from the layout, leaving Compass Rose first.

Every side panel has an independent setting, controlled by its eye opposite the close button. All panel details start GM-only. Players always retain the illustrated header of an accessible marker's panel; revealing details shows everything below that header. The party, Innspiration, and each canton/province are independent. GM mode always displays the full panel. New panels should pass an explicit, stable third argument to `openPanel(title, html, visibilityId)` and put their public header in `.panel-hero`.

## Shared service

`map-access.js` uses the existing Gaileia Visibility Service:

- `POST /session`: existing compendium password validation.
- `GET /map-visibility`: map settings and R2 object revision.
- `PUT /map-visibility`: authenticated single-setting update with `{ key, visible, revision }`.

Map data lives in `gaileia-map/player-visibility-v1.json`, separately from compendium IDs. Conditional writes reject stale edits. The map refreshes settings every 20 seconds while visible and when returning to the tab. Changes are shown as saved only after server confirmation. If settings cannot be loaded, player overlays/details stay unavailable until reconnection; GM authentication requires the service as well. The GM can still inspect everything if the visibility endpoint fails after authentication.

Layer defaults: Settlements GM-only, other overlays player-accessible. Panel defaults: all details GM-only. The server stores only explicit overrides. This is a spoiler-management interface, not secrecy for assets or content contained in the public GitHub repository.

## Verification

Syntax: `node --check map-access.js`. The inline script in `index.html` should also be syntax checked.

The DOM integration suite runs the actual Leaflet and application scripts against jsdom, with a mocked HTTP service. Install development-only dependencies in a temporary directory and run:

```sh
npm install --prefix /tmp/gaileia-tests jsdom@26 leaflet@1.9.4 --no-audit --no-fund
NODE_PATH=/tmp/gaileia-tests/node_modules node tests/map-access.test.cjs
```

The service source has separate authentication, validation, storage-isolation and write-conflict tests. No build step is required for the GitHub Pages map. Review the visual layout in a browser before merging; automated DOM tests do not assess rendering.

## Shared marker positions

In GM mode, enable **Drag Markers**, close any open information panel, and move a marker. Wait for **Marker locations saved for all viewers.** The service saves the position across browsers and computers. Players load it without signing in, and open pages refresh every 20 seconds while visible or when returning to the tab.

This applies to Envoys, Innspiration, capitals, settlements and hometowns. Canton/province emblems remain non-draggable. Stable IDs include marker type, so the capital and hometown named Oceanside do not collide.

`map-marker-sync.js` calls the existing service at `https://gaileia-visibility-service.casstform.chatgpt.site`:

- Public `GET /map-markers` returns `{ positions: {}, revision: null }` initially, then a dictionary such as `{ "party:envoys-of-the-fall": { "x": 7200, "y": 7300 } }` plus an opaque revision.
- Authenticated `PUT /map-markers` accepts `{ key, position: { x, y }, revision }`, merges only that marker into the shared dictionary and returns the full state. The existing GM password is used in memory only.
- Positions are stored separately in R2 at `gaileia-map/marker-positions-v1.json`. Conditional writes reject stale revisions with 409; the client reloads and retries its queued move without deleting other marker positions.
- Keys match `^[a-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$` and are at most 96 characters. Coordinates are finite numbers in 0–16384. Maximum 2000 entries. Unauthorized, invalid and stale updates are rejected.

Shared coordinates take precedence over browser-local fallback. Existing local positions with no shared entry stay local until you move that marker in GM mode. Unsent moves are stored separately in `gaileia.marker.pending.v1`, survive reloads and retry once connected and authenticated. Until the success message appears, a locally saved move is not guaranteed to appear on other computers. Returning to Player clears the in-memory password and prevents further uploads. No passwords are saved in localStorage.

The prior `gaileia.party.pos.v1` position is still recognized. This browser retains fallback positions for offline use; an offline viewer may show the last position it received.

## Cross-context integration test

With the service checkout available, the additional suite runs independent DOM and localStorage contexts against the actual Worker implementation using an isolated in-memory R2 substitute:

```sh
GAILEIA_SERVICE_WORKER=/absolute/path/to/service/worker/index.js NODE_PATH=/tmp/gaileia-tests/node_modules node tests/shared-markers.test.cjs
```

It verifies home-to-game-browser synchronization, public reads, fresh visits, concurrent marker edits and persistence/retry of an offline move across closing and reopening. The service suite additionally tests authentication, coordinate validation, CORS, atomic creation/update conflicts and isolation from compendium/map visibility data.
