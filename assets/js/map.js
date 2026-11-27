// Map view: MapLibre GL (self-hosted) with free OpenFreeMap tiles. Loaded only when a
// visitor taps "Map", so the rest of the site stays fast.

import { CONFIG } from './config.js';
import { CATEGORY_BY_ID } from './taxonomy.js';

const SRC = 'places';
const LOAD_TIMEOUT = 15000;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
// Same as app.js: icons come from the SVG sprite in index.html.
const icon = name => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

let lib = null;
let map = null;
let ready = null;
let popup = null;
let handlers = {};
let lastKey = '';
let parts = []; // the map's own elements in the container
let supported = null; // can this browser run MapLibre? Checked on first use.
// Why not, in plain words. Most often the browser is too old, but an up-to-date one can still fail to start
// the computer's graphics (hardware acceleration turned off, a blocked graphics driver).
const TOO_OLD = 'This browser is too old to show the map.';
const NO_GRAPHICS = 'This device couldn’t start the map.';
let reason = TOO_OLD;

function loadCss() {
  if (document.querySelector('link[data-maplibre]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../vendor/maplibre/maplibre-gl.css', import.meta.url).href;
  link.dataset.maplibre = '';
  // Ahead of the site's stylesheet, so app.css can restyle the map's buttons and popups.
  const site = document.querySelector('link[rel="stylesheet"]');
  if (site) site.before(link);
  else document.head.append(link);
}

// The bundled MapLibre needs WebGL2 and newer JavaScript (class static blocks: Safari 16.4,
// Chrome 94, Firefox 93). Checking first spares older iPads a big download that can't work.
function canRunMap() {
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    new Function('class A { static {} }');
  } catch (err) {
    return !(err instanceof SyntaxError); // a page that blocks eval can still try
  }
  return true;
}

function showUnsupported(container) {
  // An old browser can't run the map at all; a device whose graphics didn't start may manage it another time.
  const heading = reason === TOO_OLD ? 'The map doesn’t work in this browser' : 'The map can’t be shown right now';
  container.innerHTML = `<div class="map-offline">${icon('map')}<h3>${heading}</h3><p>${reason} Every place is still in the list, with phone numbers and addresses.</p><button type="button" class="btn btn-primary" data-view-list>${icon('list')}Show the list</button></div>`;
  showNote(container, false);
}

// The note under the map ("Tap a dot to see the place") makes no sense without one. app.css hides it
// with :has(), which older browsers (the ones most likely to see this message) don't support.
function showNote(container, show) {
  const note = container.closest?.('.map-wrap')?.querySelector('.map-note');
  if (note) note.hidden = !show;
}

function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function ensureMap(container) {
  if (ready) return ready;
  ready = (async () => {
    loadCss();
    lib = await import('../vendor/maplibre/maplibre-gl.mjs').catch(err => {
      if (err instanceof SyntaxError) supported = false; // JavaScript this browser can't read
      throw err;
    });
    container.innerHTML = '';
    const touch = window.matchMedia('(pointer: coarse)').matches;
    try {
      map = new lib.Map({
        container,
        style: prefersDark() ? CONFIG.mapStyle.dark : CONFIG.mapStyle.light,
        center: CONFIG.mapCenter,
        zoom: CONFIG.mapZoom,
        minZoom: 9,
        maxZoom: 18,
        attributionControl: { compact: false },
        cooperativeGestures: touch, // one finger scrolls the page, two fingers move the map
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch (err) {
      if (err?.name === 'GPUInitializationError') { // WebGL2 is there, but the graphics wouldn't start
        supported = false;
        reason = NO_GRAPHICS;
      }
      throw err;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new lib.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right');
    parts = [...container.children];
    await whenLoaded(map);
    addLayers();
  })();
  ready.catch(() => { ready = null; dropMap(); });
  return ready;
}

// Resolves once the map has drawn. Rejects if it takes too long, or at once if its style can't
// load (blocked or offline): until the style arrives, any error means the style itself failed.
function whenLoaded(m) {
  return new Promise((resolve, reject) => {
    let styled = false;
    const timer = setTimeout(() => finish(new Error('Map timed out')), LOAD_TIMEOUT);
    const onError = e => { if (!styled) finish(e.error || new Error('Map style failed to load')); };
    function finish(err) {
      clearTimeout(timer);
      m.off('error', onError);
      if (err) reject(err);
      else resolve();
    }
    m.once('style.load', () => { styled = true; });
    m.on('error', onError);
    m.once('load', () => finish());
  });
}

// A map that failed is removed, so retries don't pile up WebGL contexts, listeners and downloads.
function dropMap() {
  try { map?.remove(); } catch { /* already gone */ }
  map = null;
  popup = null;
  lastKey = '';
  parts = [];
}

function addLayers() {
  map.addSource(SRC, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 36,
    clusterMaxZoom: 15,
  });
  const dark = prefersDark();
  map.addLayer({
    id: 'clusters', type: 'circle', source: SRC, filter: ['has', 'point_count'],
    paint: {
      'circle-color': dark ? '#8fd4ae' : '#1f4a37',
      'circle-radius': ['step', ['get', 'point_count'], 17, 10, 21, 30, 26],
      'circle-stroke-width': 3,
      'circle-stroke-color': dark ? '#0e1411' : '#ffffff',
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: SRC, filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 15, 'text-allow-overlap': true },
    paint: { 'text-color': dark ? '#0b1810' : '#ffffff' },
  });
  map.addLayer({
    id: 'points', type: 'circle', source: SRC, filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'pin'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 16, 10],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': dark ? '#0e1411' : '#ffffff',
    },
  });
  map.addLayer({
    id: 'point-labels', type: 'symbol', source: SRC, filter: ['!', ['has', 'point_count']], minzoom: 14.5,
    layout: {
      'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 13,
      'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9,
    },
    paint: { 'text-color': dark ? '#eeebe3' : '#1d2a22', 'text-halo-color': dark ? '#0e1411' : '#ffffff', 'text-halo-width': 1.6 },
  });

  map.on('click', 'clusters', async e => {
    const f = e.features && e.features[0];
    if (!f) return;
    try {
      const zoom = await map.getSource(SRC).getClusterExpansionZoom(f.properties.cluster_id);
      map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(zoom + 0.3, 17), duration: reduceMotion() ? 0 : 500 });
    } catch { /* ignore */ }
  });
  map.on('click', 'points', e => {
    const f = e.features && e.features[0];
    if (f) openPopup(f);
  });
  for (const layer of ['clusters', 'points']) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
  }
}

function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function openPopup(f) {
  popup?.remove();
  const p = f.properties;
  const el = document.createElement('div');
  el.className = 'pop';
  el.innerHTML = `<p class="pop-name">${esc(p.name)}</p><p class="pop-sub">${esc(p.sub)}</p><button type="button" class="btn btn-primary">See details</button>`;
  el.querySelector('button').addEventListener('click', () => handlers.onSelect && handlers.onSelect(p.id));
  popup = new lib.Popup({ offset: 14, maxWidth: '300px', closeButton: true, focusAfterOpen: true })
    .setLngLat(f.geometry.coordinates)
    .setDOMContent(el)
    .addTo(map);
}

/**
 * Show these businesses on the map (creating it the first time).
 * @param {HTMLElement} container
 * @param {Array<object>} businesses  records from data/businesses.json
 * @param {{ onSelect?: (id: string) => void }} opts
 */
export async function showMap(container, businesses, opts = {}) {
  handlers = opts;
  if (supported === null) supported = canRunMap();
  if (!supported) return showUnsupported(container);
  try {
    await ensureMap(container);
  } catch (err) {
    if (supported) throw err; // a network problem: app.js says so, and the next try starts afresh
    return showUnsupported(container);
  }
  // app.js's offline message replaces the map on the page. Put the same map back.
  if (map.getCanvasContainer().parentNode !== container) container.replaceChildren(...parts);
  showNote(container, true);
  map.resize();
  const features = businesses
    .filter(b => typeof b.lat === 'number' && typeof b.lon === 'number')
    .map(b => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
      properties: { id: b.id, name: b.name, sub: b.sub || '', pin: CATEGORY_BY_ID[b.category]?.pin || '#1f4a37' },
    }));
  const key = features.map(f => f.properties.id).join('|');
  if (key === lastKey) return;
  lastKey = key;
  popup?.remove();
  map.getSource(SRC).setData({ type: 'FeatureCollection', features });
  if (!features.length) return;
  const bounds = new lib.LngLatBounds();
  for (const f of features) bounds.extend(f.geometry.coordinates);
  map.fitBounds(bounds, { padding: { top: 60, bottom: 50, left: 50, right: 60 }, maxZoom: 15.5, duration: reduceMotion() ? 0 : 700 });
}
