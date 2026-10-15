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

## Marker position persistence

When the GM enables **Drag Markers**, each draggable place marker saves its map-image pixel coordinates to browser `localStorage` on drag end. Stored IDs include marker type (for example, `capital:oceanside` versus `hometown:oceanside`) so names can repeat safely. Saved positions are loaded on the next visit in the same browser and remain independent of which overlays are enabled. The Envoys of the Fall marker first checks the new per-marker position and then falls back to its former `gaileia.party.pos.v1` value so existing party moves are retained.

**Scope:** marker positions are browser-local, not shared between devices, browsers, users, or private-browsing sessions. The shared visibility service only stores visibility flags; cross-device marker synchronization would require a dedicated authenticated server endpoint. Canton/province emblems are not draggable, so this change does not affect their coordinates. No location is saved from Player mode.
