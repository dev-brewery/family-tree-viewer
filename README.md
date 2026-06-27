# Family Tree Viewer

An interactive, **read-only** family tree viewer for any [Gramps Web](https://www.grampsweb.org/)
instance. Point it at your Gramps Web API, give it a read-only account, and share a clean,
no-login tree with relatives.

```
┌──────────────────┐   REST /api    ┌──────────────────┐
│ Family Tree      │ ◄────────────► │   Gramps Web     │
│ Viewer (SPA)     │   JWT auth     │   (your data)    │
│ Vite · family-   │                │   Python API     │
│ chart · d3 · CSS │                │   GEDCOM · media │
└──────────────────┘                └──────────────────┘
```

The viewer is **data-agnostic** — it works with whatever tree your Gramps Web instance holds
and presumes nothing about names or content.

## Features

- 🌳 Smooth pan / zoom / fit canvas (mouse, trackpad, touch)
- 🧭 Breadcrumb trail of the people you've focused
- 🔍 Type-ahead search with a results dropdown and keyboard nav
- 🔢 Generation filter (show/hide tree depths)
- 👤 Detail panel: dates, places, parents, spouses, children — all click-to-navigate
- 🖼️ Photos from Gramps media, with a clean initials fallback
- 🎨 Light/dark mode (saved) and mobile responsive
- 🏷️ Configurable title/branding — no hardcoded names

## Quick start (Docker)

```bash
docker run -d --name family-tree-viewer -p 8080:80 \
  -e GRAMPS_API_URL=http://YOUR_GRAMPS_HOST:5050 \
  -e GRAMPS_VIEWER_USER=YOUR_READONLY_USER \
  -e GRAMPS_VIEWER_PASS=YOUR_READONLY_PASS \
  -e VIEWER_TITLE="Our Family Tree" \
  devbrewery/family-tree-viewer:latest
```

Then open `http://YOUR_HOST:8080`. Images are published to:

- Docker Hub: `devbrewery/family-tree-viewer:latest`
- GHCR (mirror): `ghcr.io/dev-brewery/family-tree-viewer:latest`

Both are multi-arch (`linux/amd64`, `linux/arm64`). A `docker-compose.yml` is included; copy
`.env.example` to `.env` and fill in your values.

## Configuration

All configuration is injected at **runtime** (no rebuild needed). The entrypoint writes these
into a small `config.js` the SPA reads on boot, then the app fetches a JWT and refreshes it
silently before expiry.

| Variable             | Required | Default                | Description |
|----------------------|----------|------------------------|-------------|
| `GRAMPS_API_URL`     | yes      | `http://grampsweb:5000`| Base URL of your Gramps Web instance (no trailing `/api`). nginx proxies `/api` to it. |
| `GRAMPS_VIEWER_USER` | yes      | —                      | A **read-only** Gramps account (Guest/Member role). Do not use an admin account. |
| `GRAMPS_VIEWER_PASS` | yes      | —                      | Password for that account. |
| `VIEWER_TITLE`       | no       | `Family Tree`          | Title shown in the header and browser tab. |

> Gramps Web typically disables anonymous read, so a read-only account is required. Using a
> Guest/Member account also ensures Gramps-private records stay hidden.

## Install on Unraid

1. Copy `family-tree-viewer.xml` into `/boot/config/plugins/dockerMan/templates-user/` on the
   Unraid flash share.
2. **Docker** tab → **Add Container** → choose `family-tree-viewer` from the **Template:** dropdown.
3. Fill in the API URL and read-only credentials, then **Apply**.

## Local development

```bash
npm install
cp .env.example .env      # set GRAMPS_API_URL / GRAMPS_VIEWER_USER / GRAMPS_VIEWER_PASS
npm run dev               # Vite dev server, proxies /api to GRAMPS_API_URL
npm run build             # production build into dist/
```

The dev server reads `VITE_*` equivalents of the variables above; the container reads the
runtime `config.js`.

## How it works

1. On load, authenticate to `POST /api/token/` and store the JWT (with silent refresh).
2. Fetch all people (`?profile=all`, which returns pre-formatted birth/death/place strings)
   and all families.
3. Transform the Gramps model into `family-chart` format and render with d3.
4. Click a card → detail panel; click a relationship → recenter and push a breadcrumb.

## Notes & limitations

- **One family per person in the chart.** `family-chart` models a single father + mother per
  person, so anyone appearing in multiple families (e.g. birth + step/adoptive) is drawn under
  their **birth** family. All relationships still resolve in the data; only the tree layout
  picks one.
- **Photos** render only when the Gramps media binaries are present; otherwise the card shows
  initials.

## Project layout

```
family-tree-viewer/
├── index.html              # HTML shell
├── docker-entrypoint.sh    # writes runtime config.js, starts nginx
├── nginx.conf              # serves the SPA, proxies /api to GRAMPS_API_URL
├── family-tree-viewer.xml  # Unraid Community Applications template
├── public/                 # styles, favicon, icon, default config.js
└── src/
    ├── main.js             # UI, tree rendering, interactions
    └── api.js              # Gramps Web API client + data transform
```

## Credits

Built on [Gramps Web](https://www.grampsweb.org/) and
[family-chart](https://github.com/donatso/family-chart). This project just packages a viewer
around them.
