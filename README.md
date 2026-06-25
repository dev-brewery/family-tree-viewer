# Family Tree Viewer

Interactive, read-only family tree visualization for the Brewer family.

## Architecture

```
┌─────────────────┐     REST API     ┌──────────────────┐
│  Family Tree    │ ◄──────────────► │   Gramps Web     │
│  Viewer (SPA)   │                  │   (Backend)      │
│                 │                  │                  │
│  - Vite + JS    │                  │  - Python API    │
│  - family-chart │                  │  - GEDCOM data   │
│  - d3.js        │                  │  - Media/photos  │
│  - CSS vars     │                  │                  │
└─────────────────┘                  └──────────────────┘
```

## Stack

- **Build:** Vite (fast dev server, optimized builds)
- **Visualization:** [family-chart](https://github.com/donatso/family-chart) (D3.js-based interactive tree)
- **Styling:** CSS custom properties (light/dark themes, no framework)
- **API:** Gramps Web REST API (JWT auth)

## Features

- 🌳 Interactive pan/zoom/drag family tree
- 🔍 Search family members by name
- 👤 Person detail panel (birth, death, parents, spouses, children)
- 🎨 Light/dark mode toggle (saved to localStorage)
- 📱 Mobile responsive
- 🔗 Clickable relationships (navigate by clicking parents/spouses/children)
- 📊 Family stats sidebar

## Development

```bash
# Install deps
npm install

# Dev server (proxy to Gramps Web API)
GRAMPS_API_URL=http://localhost:5000 \
VITE_GRAMPS_API_URL=http://localhost:5000 \
VITE_GRAMPS_USER=owner \
VITE_GRAMPS_PASS=owner \
npm run dev

# Build for production
npm run build
```

## Deployment

The built SPA (`dist/`) can be served as:
1. A static file served by Gramps Web itself (if configured)
2. A separate container behind NPM (Nginx Proxy Manager)
3. A subfolder on any web server

Point `VITE_GRAMPS_API_URL` to the Gramps Web instance.

## Data Flow

1. App fetches all people + families from Gramps Web API on load
2. Transforms Gramps data model to `family-chart` format
3. Renders interactive tree with D3.js
4. User clicks a card → detail panel slides in
5. User clicks a relationship → tree recenters on that person

## File Structure

```
family-tree-viewer/
├── index.html          # Main HTML shell
├── package.json        # Dependencies
├── vite.config.js      # Vite config with API proxy
├── public/
│   ├── styles.css      # All styles (light/dark themes)
│   └── favicon.svg
└── src/
    ├── main.js         # App entry, UI logic, tree rendering
    └── api.js          # Gramps Web API client + data transformer
```

## TODO

- [ ] Generation filtering (show/hide generations)
- [ ] Photo display from Gramps media
- [ ] "How am I related?" path finder
- [ ] Timeline view
- [ ] Export/print tree
- [ ] Full-text search with results dropdown
