import { createChart, handlers } from 'family-chart';
import {
  fetchPeople,
  fetchFamilies,
  transformToFamilyChart,
  setToken,
  login,
  refreshToken,
  fetchPersonMedia,
  mediaThumbUrl,
  mediaFileUrl,
} from './api.js';

// State
let f3Chart = null;
let f3Card = null;
let chartData = null;
let currentFocusId = null;
let rootId = null;
let depthMap = {}; // person id -> generation depth (0 = root)
let genFilter = new Set([0, 1, 2, 3]); // checked generation buckets
let trail = []; // breadcrumb trail of person ids

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const MAX_CRUMBS = 6;

// DOM elements
const $ = (sel) => document.querySelector(sel);
const tree = $('#tree');
const loading = $('#loading');
const sidebar = $('#sidebar');
const detailPanel = $('#detail-panel');
const detailContent = $('#detail-content');
const searchInput = $('#search');
const searchResults = $('#search-results');
const breadcrumbs = $('#breadcrumbs');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fullName(p) {
  return `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
}

function initialsOf(p) {
  return `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase() || '?';
}

function lifespan(p) {
  const b = p.birth_date || '';
  const d = p.death_date || '';
  if (!b && !d) return '';
  return `${b || '?'} – ${d || '—'}`;
}

/**
 * Avatar markup with rock-solid initials fallback. The <img> is layered over
 * the initials; if it fails to load (binaries 404 on this instance) it removes
 * itself via onerror, revealing the initials. No broken-image icon ever shows.
 */
function avatarHtml(p, size) {
  const initials = esc(initialsOf(p));
  const url = p.media_handle ? mediaThumbUrl(p.media_handle, size) : '';
  const img = url
    ? `<img class="fc-photo" src="${esc(url)}" alt="" loading="lazy" onerror="this.remove()">`
    : '';
  return `<span class="fc-initials">${initials}</span>${img}`;
}

// ---------------------------------------------------------------------------
// Static control wiring (safe to attach before data loads)
// ---------------------------------------------------------------------------

// Theme toggle
$('#theme-toggle').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});

// Restore theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme) {
  document.documentElement.setAttribute('data-theme', savedTheme);
}

// Sidebar toggle (mobile)
$('#menu-toggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});

// Zoom controls — real d3 zoom on chart.svg, clamped via scaleExtent.
function zoomBy(factor) {
  if (!f3Chart) return;
  try {
    handlers.manualZoom({ amount: factor, svg: f3Chart.svg, transition_time: 300 });
  } catch (err) {
    console.warn('Zoom failed:', err.message);
  }
}
$('#zoom-in').addEventListener('click', () => zoomBy(1.25));
$('#zoom-out').addEventListener('click', () => zoomBy(0.8));
$('#fit-to-screen').addEventListener('click', () => {
  if (f3Chart) f3Chart.updateTree({ tree_position: 'fit' });
});

// Detail panel close
$('#detail-close').addEventListener('click', () => {
  detailPanel.classList.add('hidden');
});

// Generation filter checkboxes
document.querySelectorAll('#generation-filter input[type="checkbox"]').forEach((cb) => {
  cb.addEventListener('change', applyGenerationFilter);
});

// Search dropdown
setupSearch();

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  applyBranding();

  // Runtime config (container) takes precedence; fall back to VITE_* for `npm run dev`.
  const cfg = (typeof window !== 'undefined' && window.__VIEWER_CONFIG__) || {};
  const username = cfg.GRAMPS_VIEWER_USER || import.meta.env.VITE_GRAMPS_USER;
  const password = cfg.GRAMPS_VIEWER_PASS || import.meta.env.VITE_GRAMPS_PASS;

  if (username && password) {
    try {
      const { access_token, refresh_token } = await login(username, password);
      setToken(access_token);
      scheduleTokenRefresh(refresh_token);
    } catch (err) {
      console.warn('Login failed, trying without auth:', err.message);
    }
  }

  try {
    const [people, families] = await Promise.all([fetchPeople(), fetchFamilies()]);

    chartData = transformToFamilyChart(people, families);
    rootId = findRootPatriarch();
    depthMap = computeDepthMap();
    currentFocusId = rootId;

    updateStats(people, families);
    loading.classList.add('hidden');
    renderTree();

    if (rootId) {
      focusPerson(rootId);
    }
  } catch (err) {
    console.error('Failed to load tree:', err);
    loading.classList.remove('hidden');
    loading.innerHTML = `<p style="color: var(--accent);">Failed to load: ${esc(err.message)}</p>`;
  }
}

/** Read branding from runtime config (TITLE / VIEWER_TITLE), fall back gracefully. */
function applyBranding() {
  const cfg = (typeof window !== 'undefined' && window.__VIEWER_CONFIG__) || {};
  const title = cfg.TITLE || cfg.VIEWER_TITLE || 'Family Tree';
  document.title = title;
  const logo = $('.logo');
  if (logo) logo.textContent = `🌳 ${title}`;
}

/**
 * Silently refresh the access token before the ~15-min expiry.
 */
function scheduleTokenRefresh(refresh_token) {
  if (!refresh_token) return;
  const REFRESH_INTERVAL = 14 * 60 * 1000; // 14 minutes
  setInterval(async () => {
    try {
      const access_token = await refreshToken(refresh_token);
      setToken(access_token);
    } catch (err) {
      console.warn('Token refresh failed:', err.message);
    }
  }, REFRESH_INTERVAL);
}

// ---------------------------------------------------------------------------
// Tree rendering (family-chart v0.9 API)
// ---------------------------------------------------------------------------

/**
 * Build the family-chart data array from chartData, honoring the generation
 * filter. Relationship references to excluded people are stripped so the
 * library never dereferences a missing node. The root is always included.
 */
function buildData() {
  const allowed = new Set();
  for (const id of Object.keys(chartData.persons)) {
    if (isGenerationVisible(id)) allowed.add(id);
  }
  if (rootId) allowed.add(rootId);

  const data = [];
  for (const id of allowed) {
    const links = chartData.links[id] || { parents: [], spouses: [], children: [] };
    data.push({
      id,
      data: chartData.persons[id].data,
      rels: {
        parents: (links.parents || []).filter((x) => allowed.has(x)),
        spouses: (links.spouses || []).filter((x) => allowed.has(x)),
        children: (links.children || []).filter((x) => allowed.has(x)),
      },
    });
  }

  // family-chart uses data[0] as the initial main person.
  const mainId = (currentFocusId && allowed.has(currentFocusId) && currentFocusId) ||
    (rootId && allowed.has(rootId) && rootId) ||
    data[0]?.id;
  const mainIdx = data.findIndex((d) => d.id === mainId);
  if (mainIdx > 0) {
    [data[0], data[mainIdx]] = [data[mainIdx], data[0]];
  }
  return data;
}

/** A person is visible when its generation bucket is checked (root always). */
function isGenerationVisible(id) {
  if (id === rootId) return true;
  const depth = depthMap[id];
  if (depth === undefined) return true; // disconnected / in-laws stay visible
  const bucket = Math.min(depth, 3);
  return genFilter.has(bucket);
}

function renderTree() {
  if (!chartData) return;

  const data = buildData();

  f3Chart = createChart(tree, data)
    .setCardXSpacing(280)
    .setCardYSpacing(180)
    .setTransitionTime(600);

  f3Card = f3Chart
    .setCardHtml()
    .setMiniTree(false)
    .setCardInnerHtmlCreator((d) => cardInnerHtml(d.data.data))
    .setOnCardClick((e, d) => focusPerson(d.data.id));

  // Clamp wheel / pinch / button zoom to a sensible range.
  const zoomObj = f3Chart.svg?.parentNode?.__zoomObj;
  if (zoomObj && zoomObj.scaleExtent) zoomObj.scaleExtent([MIN_ZOOM, MAX_ZOOM]);

  f3Chart.updateTree({ initial: true, tree_position: 'fit' });
}

/** Custom card body: avatar (photo w/ initials fallback) + name + lifespan. */
function cardInnerHtml(p) {
  return `
    <div class="fc-card">
      <div class="fc-avatar fc-avatar-sm">${avatarHtml(p, 160)}</div>
      <div class="fc-card-body">
        <div class="fc-card-name">${esc(fullName(p))}</div>
        <div class="fc-card-dates">${esc(lifespan(p))}</div>
      </div>
    </div>`;
}

/** Re-render the tree dataset after a filter change. */
function rerender(position = 'main_to_middle') {
  if (!f3Chart) return;
  const data = buildData();
  f3Chart.updateData(data);
  if (currentFocusId && data.find((d) => d.id === currentFocusId)) {
    f3Chart.store.updateMainId(currentFocusId);
  }
  f3Chart.updateTree({ tree_position: position });
}

// ---------------------------------------------------------------------------
// Navigation: focus, breadcrumbs
// ---------------------------------------------------------------------------
function focusPerson(id, addCrumb = true) {
  if (!chartData || !chartData.persons[id]) return;
  currentFocusId = id;

  if (f3Chart) {
    const inData = f3Chart.store.getData()?.find((d) => d.id === id);
    if (inData) {
      f3Chart.store.updateMainId(id);
      f3Chart.updateTree({ tree_position: 'main_to_middle' });
    }
  }

  if (addCrumb) pushCrumb(id);
  showPersonDetail(id);
}

function pushCrumb(id) {
  if (trail[trail.length - 1] === id) return; // de-dupe consecutive
  const idx = trail.indexOf(id);
  if (idx !== -1) {
    trail = trail.slice(0, idx + 1); // jumping back to a visited person
  } else {
    trail.push(id);
  }
  if (trail.length > MAX_CRUMBS) trail = trail.slice(trail.length - MAX_CRUMBS);
  renderBreadcrumbs();
}

function renderBreadcrumbs() {
  if (!trail.length) {
    breadcrumbs.classList.add('hidden');
    breadcrumbs.innerHTML = '';
    return;
  }
  breadcrumbs.classList.remove('hidden');

  const capped = trail.length >= MAX_CRUMBS;
  const parts = trail.map((id, i) => {
    const p = chartData.persons[id]?.data;
    const name = p ? fullName(p) : id;
    const last = i === trail.length - 1;
    return `<button class="crumb${last ? ' crumb-current' : ''}" data-id="${esc(id)}" type="button">${esc(name)}</button>`;
  });

  let html = parts.join('<span class="crumb-sep" aria-hidden="true">›</span>');
  if (capped) {
    html = `<span class="crumb-ellipsis" aria-hidden="true">…</span>` +
      `<span class="crumb-sep" aria-hidden="true">›</span>` + html;
  }
  breadcrumbs.innerHTML = html;

  breadcrumbs.querySelectorAll('.crumb').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const idx = trail.indexOf(id);
      if (idx !== -1) trail = trail.slice(0, idx + 1);
      renderBreadcrumbs();
      focusPerson(id, false);
    });
  });
}

// ---------------------------------------------------------------------------
// Search dropdown
// ---------------------------------------------------------------------------
let searchMatches = [];
let searchActive = -1;

function setupSearch() {
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    if (!q || !chartData) {
      closeSearch();
      return;
    }
    searchMatches = Object.values(chartData.persons)
      .filter((p) => fullName(p.data).toLowerCase().includes(q))
      .slice(0, 8);
    searchActive = -1;
    renderSearch();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (searchResults.classList.contains('hidden')) {
      if (e.key === 'ArrowDown' && searchInput.value.trim()) {
        searchInput.dispatchEvent(new Event('input'));
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSearch(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSearch(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = searchMatches[searchActive] || searchMatches[0];
      if (pick) selectSearch(pick.id);
    } else if (e.key === 'Escape') {
      closeSearch();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) closeSearch();
  });
}

function renderSearch() {
  if (!searchMatches.length) {
    searchResults.innerHTML = `<div class="search-empty">No matches</div>`;
    searchResults.classList.remove('hidden');
    searchInput.setAttribute('aria-expanded', 'true');
    return;
  }
  searchResults.innerHTML = searchMatches
    .map((p, i) => {
      const d = p.data;
      const span = lifespan(d);
      return `<div class="search-item${i === searchActive ? ' active' : ''}" role="option" data-id="${esc(p.id)}">
          <span class="search-item-name">${esc(fullName(d))}</span>
          ${span ? `<span class="search-item-dates">${esc(span)}</span>` : ''}
        </div>`;
    })
    .join('');
  searchResults.classList.remove('hidden');
  searchInput.setAttribute('aria-expanded', 'true');

  searchResults.querySelectorAll('.search-item').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus, fire before input blur
      selectSearch(el.dataset.id);
    });
  });
}

function moveSearch(delta) {
  if (!searchMatches.length) return;
  searchActive = (searchActive + delta + searchMatches.length) % searchMatches.length;
  renderSearch();
  const active = searchResults.querySelector('.search-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function selectSearch(id) {
  closeSearch();
  searchInput.value = '';
  focusPerson(id);
}

function closeSearch() {
  searchResults.classList.add('hidden');
  searchResults.innerHTML = '';
  searchActive = -1;
  searchInput.setAttribute('aria-expanded', 'false');
}

// ---------------------------------------------------------------------------
// Generation filter
// ---------------------------------------------------------------------------
function applyGenerationFilter() {
  genFilter = new Set();
  document.querySelectorAll('#generation-filter input[type="checkbox"]').forEach((cb) => {
    if (cb.checked) genFilter.add(Number(cb.value));
  });
  rerender('fit');
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
function showPersonDetail(id) {
  const person = chartData.persons[id];
  if (!person) return;
  const links = chartData.links[id] || { parents: [], spouses: [], children: [] };
  const d = person.data;

  const parents = (links.parents || []).map((pid) => chartData.persons[pid]).filter(Boolean);
  const spouses = (links.spouses || []).map((sid) => chartData.persons[sid]).filter(Boolean);
  const children = (links.children || []).map((cid) => chartData.persons[cid]).filter(Boolean);

  const relLink = (p) => `
    <div class="detail-relationship" data-person-id="${esc(p.id)}">
      <span>${esc(fullName(p.data))}</span>
      <span class="detail-rel-dates">${esc(lifespan(p.data))}</span>
    </div>`;

  const genderClass = d.gender === 'M' ? 'male' : d.gender === 'F' ? 'female' : 'genderless';

  detailContent.innerHTML = `
    <div class="detail-avatar fc-avatar ${genderClass}">${avatarHtml(d, 400)}</div>
    <div class="detail-name">${esc(fullName(d))}</div>
    <div class="detail-dates">${esc(lifespan(d)) || 'Dates unknown'}</div>
    ${d.birth_place ? `<div class="detail-place">📍 ${esc(d.birth_place)}</div>` : ''}
    ${parents.length ? `
      <div class="detail-section">
        <h4>Parents</h4>
        ${parents.map(relLink).join('')}
      </div>` : ''}
    ${spouses.length ? `
      <div class="detail-section">
        <h4>Spouse${spouses.length > 1 ? 's' : ''}</h4>
        ${spouses.map(relLink).join('')}
      </div>` : ''}
    ${children.length ? `
      <div class="detail-section">
        <h4>Children (${children.length})</h4>
        ${children.map(relLink).join('')}
      </div>` : ''}
    <div class="detail-section">
      <h4>Gramps ID</h4>
      <code class="detail-code">${esc(d.gramps_id)}</code>
    </div>
  `;

  detailContent.querySelectorAll('.detail-relationship').forEach((el) => {
    el.addEventListener('click', () => focusPerson(el.dataset.personId));
  });

  detailPanel.classList.remove('hidden');

  // Wire fetchPersonMedia() for the detail panel: confirm/upgrade the photo to
  // the full-size file when media metadata is available. Binaries 404 on this
  // instance, so onerror still falls back to initials.
  loadDetailPhoto(id);
}

async function loadDetailPhoto(id) {
  let handle = chartData.persons[id]?.data.media_handle;
  try {
    const media = await fetchPersonMedia(id);
    const m = Array.isArray(media) ? media[0] : null;
    if (m && (m.handle || m.gramps_id)) handle = m.handle || handle;
  } catch {
    /* keep handle from media_list */
  }
  if (!handle) return;
  const avatar = detailContent.querySelector('.detail-avatar');
  if (!avatar || avatar.querySelector('.fc-photo')) return;
  const img = document.createElement('img');
  img.className = 'fc-photo';
  img.alt = '';
  img.onerror = () => img.remove();
  img.src = mediaFileUrl(handle);
  avatar.appendChild(img);
}

// ---------------------------------------------------------------------------
// Stats / generations
// ---------------------------------------------------------------------------
function findRootPatriarch() {
  for (const [id, links] of Object.entries(chartData.links)) {
    if (links.parents.length === 0 && links.children.length > 0) {
      return id;
    }
  }
  return Object.keys(chartData.persons)[0];
}

/**
 * BFS depth map from the root patriarch. Children increment depth; spouses
 * inherit their partner's depth so in-married people get a generation too.
 */
function computeDepthMap() {
  const depth = {};
  if (!chartData || !rootId) return depth;
  const links = chartData.links;
  depth[rootId] = 0;
  const queue = [rootId];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    const d = depth[id];
    for (const sp of links[id]?.spouses || []) {
      if (depth[sp] === undefined) {
        depth[sp] = d;
        queue.push(sp);
      }
    }
    for (const ch of links[id]?.children || []) {
      if (depth[ch] === undefined) {
        depth[ch] = d + 1;
        queue.push(ch);
      }
    }
  }
  return depth;
}

function updateStats(people, families) {
  const living = people.filter((p) => !p.profile?.death).length;
  const total = people.length;
  const maxDepth = Object.values(depthMap).reduce((m, d) => Math.max(m, d), 0);
  const generations = Object.keys(depthMap).length ? maxDepth + 1 : 0;
  $('#stats').innerHTML = `
    <div>Total people: <span class="stat-value">${total}</span></div>
    <div>Living: <span class="stat-value">${living}</span></div>
    <div>Families: <span class="stat-value">${families.length}</span></div>
    <div>Generations: <span class="stat-value">${generations}</span></div>
  `;
}

// Start
init();
