# RunMapper

A Progressive Web App for planning, editing, and saving running routes as
**GPX** files. Tap on the map to drop points, RunMapper snaps the segments to
real footpaths and roads using the [BRouter] public API, and you can export the
result to `.gpx` for any watch / app that understands it.

Built to feel native on an iPad (full-screen MapLibre map, touch-friendly
controls, safe-area aware), but works in any modern browser.

## Features

- **Map-based route planner** with MapLibre GL and free OSM-based vector tiles
  from [OpenFreeMap].
- **Real-path routing** via [BRouter] – choose between Trekking, Fast/road,
  Hiking/trail, or Shortest path profiles. Routing is per-leg, so dragging a
  single waypoint only re-fetches what changed.
- **Edit waypoints** by tapping (Add mode), long-pressing (Pan mode),
  drag-to-move, tap-on-line to insert, and delete from the bottom panel.
- **Distance, ascent, descent and an elevation profile** computed from
  BRouter's elevation data.
- **Open and save GPX files** directly to disk via the File System Access API,
  with a graceful download/upload fallback on iPad Safari.
- **Local library** of saved routes backed by IndexedDB.
- **Undo / redo** with full keyboard shortcuts (Cmd+Z, Cmd+Shift+Z, Cmd+S,
  Cmd+Shift+S, Cmd+O).
- **Installable PWA** – Add to Home Screen on iPad/iPhone, runs offline once
  loaded (cached map tiles, cached routing responses, cached app shell).
- **No backend required.** Everything runs in your browser.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5173 (HTTP, fastest)
pnpm dev:https    # https://localhost:5173 (self-signed) — required for iPad geolocation
pnpm build        # production bundle in ./dist
pnpm preview      # serve ./dist locally
pnpm typecheck
```

> The project uses [pnpm](https://pnpm.io/), but `npm`/`yarn` will also work.

### Testing on the iPad

Both `pnpm dev` and `pnpm dev:https` bind to your LAN, so the iPad can browse to your Mac's IP. Find it with `ipconfig getifaddr en0`.

For most features (drawing routes, saving GPX, etc.) plain HTTP works fine on the iPad. **For the "find me" geolocate button, you must use `pnpm dev:https`** — iOS Safari only exposes `navigator.geolocation` on secure origins (HTTPS or `localhost`). Tap *Show Details → visit this website* the first time you hit the self-signed cert warning.

## Tech stack

| Concern        | Choice                                                            |
| -------------- | ----------------------------------------------------------------- |
| Framework      | React 18 + TypeScript + Vite                                      |
| Map            | [MapLibre GL JS][maplibre] with [OpenFreeMap] `liberty` style     |
| Routing engine | [BRouter] public API (`https://brouter.de/brouter`)               |
| State          | [zustand](https://zustand-demo.pmnd.rs/)                          |
| GPX            | Custom serializer/parser on top of `fast-xml-parser`              |
| Storage        | File System Access API + IndexedDB (`idb`)                        |
| PWA            | `vite-plugin-pwa` (Workbox runtime caching for tiles + routing)   |
| Styling        | Tailwind CSS                                                      |

## Project layout

```
src/
  App.tsx                     # composition root
  main.tsx                    # bootstrap
  components/
    MapView.tsx               # MapLibre map, route layers, marker drag/tap
    Toolbar.tsx               # top floating toolbar
    RoutePanel.tsx            # bottom sheet with stats, name, profile
    ElevationProfile.tsx      # inline SVG profile
    WaypointList.tsx          # editable waypoint list
    LibraryDrawer.tsx         # IndexedDB-backed saved routes
    InstallHint.tsx           # one-shot iOS A2HS hint
  state/
    routeStore.ts             # waypoints, legs, profile, undo/redo
  services/
    brouter.ts                # per-leg BRouter calls + in-memory cache
    gpx.ts                    # parseGpx, serializeGpx (GPX 1.1)
    fsAccess.ts               # File System Access wrapper + download fallback
    idb.ts                    # save/load/list/delete routes
  hooks/
    useInstallHint.ts
  types.ts
  styles.css
```

## GPX format

RunMapper exports GPX 1.1 with:

- A single `<trk>` containing the routed polyline as `<trkpt>`s with `<ele>`.
- One `<wpt>` per planned waypoint so the route is fully editable on reload.
- A custom `runmapper:` extension block in `<metadata><extensions>` that
  preserves the routing profile and exact waypoint order/IDs for lossless
  round-tripping. Files written by RunMapper re-open as fully editable
  routes; generic GPX files import as a single track between two endpoints.

## Deploying

Because RunMapper is a static SPA, any static host works.

### GitHub Pages (default)

The repo ships with a workflow at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) that builds with
pnpm and publishes to GitHub Pages on every push to `main`. To enable it:

1. In **Settings → Pages**, set **Source: GitHub Actions** (one-time).
2. Push to `main`. The workflow builds `dist/` and deploys to
   `https://<your-user>.github.io/run-mapper/`.

The build is configured for a project-site sub-path:

- `base: "/run-mapper/"` in [vite.config.ts](vite.config.ts)
- PWA `start_url`, `scope`, and the service-worker `navigateFallback` all
  point at the same sub-path.
- [`public/404.html`](public/404.html) is a tiny shim that redirects unknown
  paths back to the app shell.

If you fork or rename the repo, update `BASE` in `vite.config.ts` and the
redirect target in `public/404.html` accordingly. For a custom domain, drop a
`public/CNAME` file with your domain, change `BASE` to `/`, and revert the
404 shim's redirect to `/`.

### Other static hosts

- **Netlify / Vercel / Cloudflare Pages**: connect the repo, build command
  `pnpm build`, publish directory `dist`. Set `base: "/"` in
  `vite.config.ts` if hosting at the apex of a domain.

## Attributions and limits

RunMapper relies on free public services. Please be considerate:

- **Map tiles**: © [OpenStreetMap] contributors, served by [OpenFreeMap]
  under their fair-use policy. Switching to your own tile server is one
  config change away.
- **Routing**: [BRouter]'s public server. The default profiles ship with
  BRouter's standard routing model. For heavy use, host your own BRouter
  instance and change `BROUTER_BASE` in `src/services/brouter.ts`.

If you're publishing RunMapper for a wider audience, consider self-hosting
both tiles and the routing engine.

## Privacy

RunMapper has no backend. No accounts, no analytics, no telemetry. Your route
data lives entirely in your browser's IndexedDB (the local library) and in
`.gpx` files you save yourself. The only network calls the app makes are:

- [BRouter](https://brouter.de/brouter) (`brouter.de`) — fetches a routed
  polyline for each leg you draw.
- [OpenFreeMap](https://openfreemap.org/) (`tiles.openfreemap.org`) — fetches
  map tiles and the vector style.

If RunMapper is served over GitHub Pages (or any other host), the host will
see your IP at the edge, as with any website. No first-party server is
involved.

## License

[MIT](LICENSE).

## Roadmap (out of scope for v1)

- Cloud sync / accounts.
- Strava and Komoot import/export shortcuts.
- Live recording during a run.
- Turn-by-turn navigation.

[BRouter]: https://brouter.de/brouter-web/
[maplibre]: https://maplibre.org/
[OpenFreeMap]: https://openfreemap.org/
[OpenStreetMap]: https://www.openstreetmap.org/copyright
