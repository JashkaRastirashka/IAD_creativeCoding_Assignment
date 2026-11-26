// Satellite world map (Web Mercator tiles) with city pins and shooting lines
// Drag = pan | Wheel / pinch = zoom | Double-click = zoom in
// + / - = zoom | R = Europe | W = world

const { min, max, abs, sin, cos, tan, log, log2, exp, acos, PI } = Math;
const HALF_PI = PI / 2, TWO_PI = PI * 2;
const radians = d => d * PI / 180;
const constrain = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const millis = () => performance.now();
const rnd = (a, b) => a + Math.random() * (b - a);
const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

// ---------- canvas ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const windowLayer = document.getElementById('window-layer');
const mapSidebar = document.getElementById('map-sidebar');
const WINDOW_GAP = 16;
let topWindowZ = 0;
// The map tiles are drawn into a buffer and only re-rendered when something changes.
const mapBuf = document.createElement('canvas'), mctx = mapBuf.getContext('2d');
const mapCredit = document.getElementById('map-credit');
let width = 0, height = 0, dpr = 1;

let mapDirty = true;     // the tile buffer must be re-rendered
let posDirty = true;     // pin screen positions must be recomputed
let frameDirty = true;   // the visible canvas must be redrawn (it is redrawn every frame while lines fly)
function invalidate() { mapDirty = posDirty = frameDirty = true; }   // view or tiles changed
function invalidateHud() { frameDirty = true; }

function getWindowArea() {
  const left = min(window.innerWidth, mapSidebar.getBoundingClientRect().right + WINDOW_GAP);
  return { left, width: max(0, window.innerWidth - left) };
}

function getMapCenterX() {
  return (mapSidebar.getBoundingClientRect().right + width) / 2;
}

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  width = window.innerWidth;
  height = window.innerHeight;
  for (const [cv, cx] of [[canvas, ctx], [mapBuf, mctx]]) {
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  hudKey = '';
  invalidate();
}

// ---------- tile source ----------
// Tile providers, switch with the T key. All are Web Mercator, 256px, z/y/x order.
const PROVIDERS = [
  { name: 'EOX Sentinel-2', maxZ: 14,
    url: (z, x, y) => 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/' + z + '/' + y + '/' + x + '.jpg',
    attribution: 'Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2019)' },
  { name: 'Esri World Imagery', maxZ: 18,
    url: (z, x, y) => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
];
let provider = 0;
const P = () => PROVIDERS[provider];
const TILE_SIZE = 256;
const MAX_Z = 18;           // deepest zoom level of the view (tiles are stretched beyond a provider's maxZ)
const TILE_CACHE = 600;     // tiles kept in memory
const BG_COLOR = '#0b1d33'; // shown where no tile has loaded yet

// Center the home view on the West Slavic region while keeping Nalchik in view.
const HOME = { lon: 22.5, lat: 49.5, zoom: 4.5 };

// ---------- Web Mercator: (lon, lat) -> [0..1, 0..1], y pointing down ----------
function project(lon, lat) {
  const l = constrain(lat, -85.0511, 85.0511);
  return [(lon + 180) / 360, 0.5 - log(tan(PI / 4 + radians(l) / 2)) / TWO_PI];
}

// ---------- markers ----------
const PIN_H = 28, PIN_R = 7;
const SPR_W = 17, SPR_H = 30;
const PIN_RELEVANCE_SCALE = {
  '#d60036': 2,
  '#b319ab': 1.8,
  '#0057ba': 1.5,
  '#1b8e13': 1,
};

function pinImportanceScale(color) {
  return PIN_RELEVANCE_SCALE[color.toLowerCase()] ?? 1;
}

let MARKERS = [];   // filled from markers.csv: { name, lon, lat, colors: [...], content, video }

// markers.csv: content is an optional local page path or URL loaded in the pin window.
// video is an optional Project 1 video ID; several colours in one city share both fields.
// Empty content shows the placeholder.
// Empty lines and lines starting with # are ignored.
async function loadMarkers(url = 'markers.csv') {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const text = (await res.text()).replace(/^\uFEFF/, '');
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  rows.shift();   // header row
  MARKERS = [];
  for (const row of rows) {
    const [name, lon, lat, colors, content, video] = row.split(',').map(c => c.trim());
    const m = { name, lon: parseFloat(lon), lat: parseFloat(lat),
                colors: (colors || '').split(/[;\s]+/).filter(Boolean),
                content: content || '', video: video || '' };
    if (!name || isNaN(m.lon) || isNaN(m.lat) || m.colors.length === 0) {
      console.warn('markers.csv: skipped invalid row:', row);
      continue;
    }
    MARKERS.push(m);
  }
}

// ---------- shooting dots ----------
const SHOT_MIN_WAIT = 1500, SHOT_MAX_WAIT = 7000, SHOT_DURATION = 1500;
const TRAIL_ALPHA = 0.8, TRAIL_WEIGHT = 2.5, TRAIL_FADE = 3000;

const PINS = [];
let DRAW_PINS = [];
const DOTS = [];
let activePinColor = null;

function pinMatchesFilter(pin) {
  return activePinColor === null || pin.color.toLowerCase() === activePinColor;
}

function setupMapFilters() {
  const buttons = [...document.querySelectorAll('#map-title button[data-color]')];
  for (const button of buttons) {
    const color = button.dataset.color.toLowerCase();
    button.addEventListener('click', () => {
      activePinColor = activePinColor === color ? null : color;
      for (const candidate of buttons)
        candidate.setAttribute('aria-pressed', String(candidate.dataset.color.toLowerCase() === activePinColor));
      DOTS.length = 0;
      nextDue = 0;
      posDirty = true;
      frameDirty = true;
    });
  }
}

function initPins() {
  const now = millis();
  MARKERS.forEach((m, mi) => {
    const [rx, ry] = project(m.lon, m.lat);   // projected once, the projection never changes
    m.colors.forEach((c, i) => {
      PINS.push({ m, mi, i, color: c, rgb: hexToRgb(c), rx, ry,
                  dx: 0,                                              // pins at one location may overlap
                  x: 0, y: 0, hy: 0, vis: false,                   // screen position, set by updatePinPositions()
                  targets: null, nextShot: now + rnd(300, SHOT_MAX_WAIT) });
    });
  });
  for (const p of PINS) p.targets = PINS.filter(q => q.mi !== p.mi);   // pins in other cities, built once
  DRAW_PINS = PINS.slice().sort((a, b) => pinImportanceScale(b.color) - pinImportanceScale(a.color));
  nextDue = 0;
  invalidate();
}

// ---------- view: screen = raw * k + t, raw = 0..1 over the whole world ----------
const view = { k: 1, tx: 0, ty: 0 };
const getMinK = () => max(width, height);
const MAX_K = TILE_SIZE * 2 ** (MAX_Z + 1);

function constrainView() {
  view.k = constrain(view.k, getMinK(), MAX_K);
  view.tx = constrain(view.tx, width - view.k, 0);
  view.ty = constrain(view.ty, height - view.k, 0);
}

function zoomAt(px, py, factor) {
  const newK = constrain(view.k * factor, getMinK(), MAX_K);
  const f = newK / view.k;
  view.tx = px - (px - view.tx) * f;
  view.ty = py - (py - view.ty) * f;
  view.k = newK;
  constrainView();
  invalidate();
}

function fitCenter(h) {
  const [x, y] = project(h.lon, h.lat);
  view.k = constrain(TILE_SIZE * 2 ** h.zoom, getMinK(), MAX_K);
  view.tx = getMapCenterX() - x * view.k;
  view.ty = height / 2 - y * view.k;
  constrainView();
  invalidate();
}
function fitHome() {
  const centerX = getMapCenterX();
  const eastLimitLon = 43.6180;
  const maxK = max(TILE_SIZE, (width - centerX - 24) * 360 / (eastLimitLon - HOME.lon));
  fitCenter({ ...HOME, zoom: min(HOME.zoom, log2(maxK / TILE_SIZE)) });
}
function fitWorld() {
  view.k = getMinK();
  view.tx = getMapCenterX() - 0.5 * view.k;
  view.ty = height / 2 - 0.5 * view.k;
  constrainView();
  invalidate();
}

// ---------- tiles ----------
// Requests are never fired straight from drawing. Each frame collects the tiles it is missing,
// and processQueue() starts the most central ones, but never more than MAX_PARALLEL at once.
// Requests for tiles that have scrolled out of view or belong to an old zoom level are cancelled.
const MAX_PARALLEL = 8;        // tile requests in flight at the same time
const RETRY_MS = 3000;         // a failed tile is requested again after this long
const ZOOM_SETTLE_MS = 150;    // after the zoom level changed, wait this long before requesting
const stats = { ok: 0, fail: 0 };
const tiles = new Map();       // "provider|z/x/y" -> tile; insertion order doubles as LRU order
const loading = new Set();     // tiles with a request in flight
const wanted = [];             // missing tiles seen in the current frame
let frameNo = 0, frameTime = 0;
let lastZ = null, lastZChange = 0;
let autoSwitches = 0;

function switchProvider() {
  provider = (provider + 1) % PROVIDERS.length;
  stats.ok = 0;
  stats.fail = 0;
  invalidate();
}

function getTile(z, x, y) {
  const key = provider + '|' + z + '/' + x + '/' + y;
  let t = tiles.get(key);
  if (t) { tiles.delete(key); tiles.set(key, t); return t; }   // move to the back (most recent)
  t = { z, x, y, provider, state: 'idle', img: null, failedAt: 0, want: 0, dist: 0 };
  tiles.set(key, t);
  return t;
}

function startLoad(t) {
  const url = PROVIDERS[t.provider].url(t.z, t.x, t.y);
  const img = new Image();
  t.img = img;
  t.state = 'loading';
  loading.add(t);
  invalidateHud();
  img.onload = () => { loading.delete(t); t.state = 'ok'; stats.ok++; invalidate(); };
  img.onerror = () => {
    loading.delete(t);
    t.state = 'failed';
    t.failedAt = millis();
    stats.fail++;
    invalidate();
    setTimeout(invalidate, RETRY_MS + 50);   // look at the tile again when it may be retried
    if (stats.fail <= 3) console.warn('Tile failed to load:', url);
    // nothing has loaded from this provider at all: try the next one (once per provider)
    if (stats.ok === 0 && stats.fail >= 12 && autoSwitches < PROVIDERS.length - 1) {
      autoSwitches++;
      console.warn('Switching tile provider');
      switchProvider();
    }
  };
  img.src = url;
}

function cancelLoad(t) {
  t.img.onload = t.img.onerror = null;
  t.img.src = '';          // aborts the request
  t.img = null;
  t.state = 'idle';
  loading.delete(t);
  invalidateHud();
}

function drawTile(z, x, y, dx, dy, ts) {
  const t = getTile(z, x, y);
  t.want = frameNo;
  if (t.state === 'ok') { mctx.drawImage(t.img, dx, dy, ts + 0.5, ts + 0.5); return; }

  if (t.state === 'idle' || (t.state === 'failed' && frameTime - t.failedAt > RETRY_MS)) {
    t.dist = Math.hypot(dx + ts / 2 - width / 2, dy + ts / 2 - height / 2);
    wanted.push(t);
  }
  // not loaded yet: show a blurry piece of an already loaded parent tile instead
  for (let up = 1; up <= 6 && z - up >= 0; up++) {
    const s = 2 ** up;
    const p = tiles.get(provider + '|' + (z - up) + '/' + (x >> up) + '/' + (y >> up));
    if (p && p.state === 'ok') {
      const sz = TILE_SIZE / s;
      mctx.drawImage(p.img, (x % s) * sz, (y % s) * sz, sz, sz, dx, dy, ts + 0.5, ts + 0.5);
      return;
    }
  }
}

function drawTiles() {
  mctx.fillStyle = BG_COLOR;
  mctx.fillRect(0, 0, width, height);
  const z = constrain(Math.round(log2(view.k / TILE_SIZE)), 0, P().maxZ);
  if (z !== lastZ) { if (lastZ !== null) lastZChange = frameTime; lastZ = z; }
  const n = 2 ** z, ts = view.k / n;
  const x0 = max(0, Math.floor(-view.tx / ts)), x1 = min(n - 1, Math.floor((width - view.tx) / ts));
  const y0 = max(0, Math.floor(-view.ty / ts)), y1 = min(n - 1, Math.floor((height - view.ty) / ts));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      drawTile(z, x, y, view.tx + x * ts, view.ty + y * ts, ts);
}

function processQueue() {
  // cancel requests for tiles that were not on screen in this frame
  for (const t of loading) if (t.want !== frameNo) cancelLoad(t);

  // start the most central missing tiles, but not while the zoom level is still changing
  if (wanted.length && frameTime - lastZChange >= ZOOM_SETTLE_MS) {
    wanted.sort((a, b) => a.dist - b.dist);
    for (const t of wanted) {
      if (loading.size >= MAX_PARALLEL) break;
      startLoad(t);
    }
  }
  mapDirty = wanted.length > 0 && frameTime - lastZChange < ZOOM_SETTLE_MS;   // check again once the zoom has settled
  wanted.length = 0;

  // keep the cache small: drop the least recently used tiles
  while (tiles.size > TILE_CACHE) {
    const [key, t] = tiles.entries().next().value;
    if (t.state === 'loading') cancelLoad(t);
    tiles.delete(key);
  }
}

// ---------- input ----------
function setupInput() {
  const el = canvas;
  el.style.touchAction = 'none';
  el.style.cursor = 'grab';
  const pointers = new Map();
  let clickStart = null, dragged = false;
  const pos = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !Number.isFinite(e.pointerId)) return;
    el.setPointerCapture(e.pointerId);
    const point = pos(e);
    if (pointers.size === 0) { clickStart = point; dragged = false; }
    else dragged = true;
    pointers.set(e.pointerId, point);
    el.style.cursor = 'grabbing';
  });

  el.addEventListener('pointermove', e => {
    if (!Number.isFinite(e.pointerId)) return;
    if (!pointers.has(e.pointerId)) {
      const point = pos(e);
      el.style.cursor = pinAt(point.x, point.y) ? 'pointer' : 'grab';
      return;
    }
    const old = new Map(pointers);
    const point = pos(e);
    pointers.set(e.pointerId, point);
    if (clickStart && dist(clickStart.x, clickStart.y, point.x, point.y) >= 6) dragged = true;
    if (pointers.size === 1) {
      const a = old.get(e.pointerId), b = pointers.get(e.pointerId);
      view.tx += b.x - a.x;
      view.ty += b.y - a.y;
    } else if (pointers.size === 2) {
      const ids = [...pointers.keys()];
      const o1 = old.get(ids[0]), o2 = old.get(ids[1]);
      const n1 = pointers.get(ids[0]), n2 = pointers.get(ids[1]);
      const nc = { x: (n1.x + n2.x) / 2, y: (n1.y + n2.y) / 2 };
      const oc = { x: (o1.x + o2.x) / 2, y: (o1.y + o2.y) / 2 };
      const od = dist(o1.x, o1.y, o2.x, o2.y), nd = dist(n1.x, n1.y, n2.x, n2.y);
      view.tx += nc.x - oc.x;
      view.ty += nc.y - oc.y;
      if (od > 0) zoomAt(nc.x, nc.y, nd / od);
    }
    constrainView();
    invalidate();
  });

  const end = (e, allowClick) => {
    if (!Number.isFinite(e.pointerId)) return;
    const point = pos(e);
    if (!allowClick) dragged = true;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) el.style.cursor = pinAt(point.x, point.y) ? 'pointer' : 'grab';
  };
  el.addEventListener('pointerup', e => end(e, true));
  el.addEventListener('pointercancel', e => end(e, false));
  el.addEventListener('click', e => {
    const point = pos(e);
    if (!dragged) {
      const hitPoint = clickStart || point;
      const pin = pinAt(hitPoint.x, hitPoint.y);
      if (pin) openMarkerWindow(pin);
    }
    clickStart = null;
    dragged = false;
  });

  el.addEventListener('wheel', e => {
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;
    const p = pos(e);
    zoomAt(p.x, p.y, exp(-d * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  el.addEventListener('dblclick', e => { const p = pos(e); zoomAt(p.x, p.y, 2); });

  window.addEventListener('keydown', e => {
    if (e.target.closest?.('.desktop-window')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'r' || k === 'R') fitHome();
    else if (k === 'w' || k === 'W') fitWorld();
    else if (k === 't' || k === 'T') switchProvider();
    else if (k === '+' || k === '=') zoomAt(getMapCenterX(), height / 2, 1.5);
    else if (k === '-' || k === '_') zoomAt(getMapCenterX(), height / 2, 1 / 1.5);
  });
}

// ---------- pins ----------
// PNG files replace the drawn pin shape. Heights are kept close to the original pin size.
const PIN_ASSETS = {
  '#d60036': 'pin_red.png',
  '#0057ba': 'pin_blue.png',
  '#1b8e13': 'pin_green.png',
  '#b319ab': 'pin_purple.png',
};
const pinSprites = new Map();   // colour -> Image
function zoomPinScale() {
  const zoom = log2(view.k / TILE_SIZE);
  return 2 ** ((zoom - HOME.zoom) * 0.2);
}
function pinScale(pin) {
  return zoomPinScale() * pinImportanceScale(pin.color);
}

async function loadPinSprites() {
  await Promise.all(Object.entries(PIN_ASSETS).map(([col, file]) => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { pinSprites.set(col, img); resolve(); };
    img.onerror = () => {
      console.warn('Could not load marker image:', file);
      resolve();
    };
    img.src = 'source/' + file;
  })));
  invalidate();
}

function drawFallbackPin(col, p) {
  const scale = pinScale(p);
  const r = PIN_R * scale, d = (PIN_H - PIN_R) * scale;
  const a = acos(r / d), a0 = HALF_PI - a, sweep = TWO_PI - 2 * a;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  const STEPS = 28;
  for (let i = 0; i <= STEPS; i++) {
    const t = a0 - (i / STEPS) * sweep;
    ctx.lineTo(p.x + r * cos(t), p.y - d + r * sin(t));
  }
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = 1.5 * scale;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.x, p.y - d, r * 0.85 / 2, 0, TWO_PI);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

// screen position of every pin, computed once per view change (not once per use)
function updatePinPositions() {
  const offsetScale = zoomPinScale();
  for (const p of PINS) {
    const scale = pinScale(p);
    p.x = view.tx + p.rx * view.k + p.dx * offsetScale;  // tip of the pin
    p.y = view.ty + p.ry * view.k;
    p.hy = p.y - (PIN_H - PIN_R) * scale;                // middle of the round head (where lines start and end)
    p.vis = pinMatchesFilter(p) &&
            p.x > -60 * scale && p.x < width + 60 * scale &&
            p.y > -60 * scale && p.y < height + 60 * scale;
  }
  posDirty = false;
}

function drawMarkers() {
  for (const p of DRAW_PINS)   // draw larger pins first so smaller pins remain visible on top
    if (p.vis) {
      const img = pinSprites.get(p.color);
      if (img) {
        const scale = pinScale(p);
        const w = SPR_W * scale, h = SPR_H * scale;
        ctx.drawImage(img, p.x - w / 2, p.y - h, w, h);
      }
      else drawFallbackPin(p.color, p);
    }
}

function pinAt(x, y) {
  if (posDirty) updatePinPositions();
  for (let i = DRAW_PINS.length - 1; i >= 0; i--) {
    const p = DRAW_PINS[i];
    const scale = pinScale(p);
    const w = SPR_W * scale, h = SPR_H * scale;
    if (p.vis && x >= p.x - w / 2 && x <= p.x + w / 2 && y >= p.y - h && y <= p.y) return p;
  }
  return null;
}

function openMarkerWindow(pin) {
  const marker = pin.m;
  const frame = document.createElement('section');
  frame.className = 'desktop-window';
  frame.setAttribute('role', 'dialog');
  frame.setAttribute('aria-label', marker.name);
  frame.style.setProperty('--window-accent', pin.color);

  const titlebar = document.createElement('div');
  titlebar.className = 'window-titlebar';
  const title = document.createElement('span');
  title.className = 'window-title';
  title.textContent = marker.name;

  const close = document.createElement('button');
  close.className = 'window-close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close ' + marker.name + ' window');
  let cleanupLoading = () => {};
  close.addEventListener('click', () => {
    cleanupLoading();
    frame.remove();
  });
  titlebar.append(title, close);

  const content = document.createElement('div');
  content.className = 'window-content';
  if (marker.content) {
    content.classList.add('window-content-embed');
    const playerFrame = document.createElement('iframe');
    const loading = document.createElement('div');
    loading.className = 'window-loading';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', 'Loading content');
    const spinner = document.createElement('span');
    spinner.className = 'window-loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    loading.append(spinner);

    const source = new URL(marker.content, window.location.href);
    const waitsForProject1Ready = source.origin === window.location.origin &&
      source.pathname.endsWith('/project1/index.html') &&
      source.searchParams.has('embed');
    if (waitsForProject1Ready) source.searchParams.set('loadingHandshake', 'project1-content-update');
    if (marker.video) source.searchParams.set('video', marker.video);
    playerFrame.src = source.href;
    playerFrame.title = marker.name + (marker.video ? ' video player' : ' content');
    playerFrame.allow = 'autoplay; fullscreen';
    const showLoadError = () => {
      spinner.remove();
      const errorText = document.createElement('span');
      errorText.textContent = 'Unable to load content.';
      loading.append(errorText);
      loading.setAttribute('role', 'alert');
      cleanupLoading();
    };
    if (waitsForProject1Ready) {
      const handleReadyMessage = event => {
        if (event.source !== playerFrame.contentWindow) return;
        if (event.data?.type === 'project1-content-ready') {
          loading.remove();
          cleanupLoading();
        } else if (event.data?.type === 'project1-content-error') {
          showLoadError();
        }
      };
      window.addEventListener('message', handleReadyMessage);
      cleanupLoading = () => window.removeEventListener('message', handleReadyMessage);
    } else {
      const handleLoad = () => loading.remove();
      playerFrame.addEventListener('load', handleLoad, { once: true });
      cleanupLoading = () => playerFrame.removeEventListener('load', handleLoad);
    }
    playerFrame.addEventListener('error', showLoadError, { once: true });
    content.append(loading, playerFrame);
  } else {
    const placeholder = document.createElement('p');
    placeholder.textContent = 'More information coming soon.';
    content.append(placeholder);
  }

  frame.append(titlebar, content);
  for (const direction of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
    const handle = document.createElement('div');
    handle.className = 'window-resize-handle window-resize-' + direction;
    handle.setAttribute('aria-hidden', 'true');
    let resizeState = null;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      frame.style.zIndex = String(++topWindowZ);
      const bounds = frame.getBoundingClientRect();
      const styles = getComputedStyle(frame);
      const area = getWindowArea();
      resizeState = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        bounds,
        minLeft: area.left,
        minWidth: parseFloat(styles.minWidth),
        minHeight: parseFloat(styles.minHeight),
        maxWidth: area.width,
        maxHeight: window.innerHeight - 16,
      };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      const state = resizeState;
      if (!state || e.pointerId !== state.pointerId) return;
      const dx = e.clientX - state.x, dy = e.clientY - state.y;
      const { bounds } = state;
      let left = bounds.left, top = bounds.top;
      let width = bounds.width, height = bounds.height;
      if (direction.includes('w')) {
        left = constrain(bounds.left + dx, state.minLeft, bounds.right - state.minWidth);
        width = bounds.right - left;
      } else if (direction.includes('e')) {
        width = constrain(bounds.width + dx, state.minWidth, min(state.maxWidth, window.innerWidth - bounds.left));
      }
      if (direction.includes('n')) {
        top = constrain(bounds.top + dy, 0, bounds.bottom - state.minHeight);
        height = bounds.bottom - top;
      } else if (direction.includes('s')) {
        height = constrain(bounds.height + dy, state.minHeight, min(state.maxHeight, window.innerHeight - bounds.top));
      }
      frame.style.left = left + 'px';
      frame.style.top = top + 'px';
      frame.style.width = width + 'px';
      frame.style.height = height + 'px';
    });
    const endResize = e => { if (resizeState?.pointerId === e.pointerId) resizeState = null; };
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
    frame.append(handle);
  }

  const index = windowLayer.children.length % 8;
  const offset = index * 24;
  windowLayer.append(frame);
  frame.style.zIndex = String(++topWindowZ);
  const area = getWindowArea();
  frame.style.minWidth = Math.min(280, area.width) + 'px';
  frame.style.maxWidth = area.width + 'px';
  frame.style.width = area.width * 0.8 + 'px';

  const rect = frame.getBoundingClientRect();
  const centeredLeft = area.left + (area.width - rect.width) / 2 + offset;
  const centeredTop = (window.innerHeight - rect.height) / 2 + offset;
  frame.style.left = constrain(centeredLeft, area.left, max(area.left, window.innerWidth - rect.width)) + 'px';
  frame.style.top = constrain(centeredTop, 0, max(0, window.innerHeight - rect.height)) + 'px';

  frame.addEventListener('pointerdown', () => {
    frame.style.zIndex = String(++topWindowZ);
  });

  let dragPointerId = null, lastX = 0, lastY = 0;
  titlebar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    dragPointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    titlebar.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  titlebar.addEventListener('pointermove', e => {
    if (e.pointerId !== dragPointerId) return;
    const bounds = frame.getBoundingClientRect();
    const area = getWindowArea();
    const left = constrain(bounds.left + e.clientX - lastX, area.left, max(area.left, window.innerWidth - bounds.width));
    const top = constrain(bounds.top + e.clientY - lastY, 0, max(0, window.innerHeight - bounds.height));
    frame.style.left = left + 'px';
    frame.style.top = top + 'px';
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = e => { if (e.pointerId === dragPointerId) dragPointerId = null; };
  titlebar.addEventListener('pointerup', endDrag);
  titlebar.addEventListener('pointercancel', endDrag);
}

function keepDesktopWindowsInView() {
  const area = getWindowArea();
  for (const frame of windowLayer.children) {
    const rect = frame.getBoundingClientRect();
    frame.style.minWidth = Math.min(280, area.width) + 'px';
    frame.style.maxWidth = area.width + 'px';
    frame.style.width = Math.min(rect.width, area.width) + 'px';
    const resized = frame.getBoundingClientRect();
    frame.style.left = constrain(rect.left, area.left, max(area.left, window.innerWidth - resized.width)) + 'px';
    frame.style.top = constrain(rect.top, 0, max(0, window.innerHeight - resized.height)) + 'px';
  }
}

// ---------- lines shot between pins ----------
let nextDue = 0;   // time when the earliest pin fires next, so most frames skip the pin loop

function updateShots(now) {
  if (now >= nextDue) {
    let due = Infinity;
    for (const p of PINS.filter(pinMatchesFilter)) {
      const targets = p.targets.filter(pinMatchesFilter);
      if (now >= p.nextShot && targets.length) {
        DOTS.push({ from: p, to: targets[Math.floor(Math.random() * targets.length)], t0: now });
        p.nextShot = now + rnd(SHOT_MIN_WAIT, SHOT_MAX_WAIT);
      }
      if (targets.length && p.nextShot < due) due = p.nextShot;
    }
    nextDue = due;
  }
  // shots are added in time order, so the oldest one is always at the front
  while (DOTS.length && now - DOTS[0].t0 >= SHOT_DURATION + TRAIL_FADE) DOTS.shift();
}

function drawTrails(now) {
  ctx.save();
  ctx.lineWidth = TRAIL_WEIGHT;
  ctx.lineCap = 'round';
  for (const d of DOTS) {
    const age = now - d.t0;
    const t = constrain(age / SHOT_DURATION, 0, 1);
    const e = 0.5 - 0.5 * cos(PI * t);
    const fade = age <= SHOT_DURATION ? 1 : 1 - (age - SHOT_DURATION) / TRAIL_FADE;
    const x0 = d.from.x, y0 = d.from.hy, x1 = d.to.x, y1 = d.to.hy;
    const x = lerp(x0, x1, e), y = lerp(y0, y1, e);
    const [r, g, b] = d.from.rgb;
    const grad = ctx.createLinearGradient(x0, y0, x, y);
    grad.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',0)');
    grad.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',' + (TRAIL_ALPHA * fade) + ')');
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- HUD ----------
let hudKey = '';

// Update the visible source credit only when the tile provider changes.
function renderHud() {
  const right = P().attribution;
  if (right === hudKey) return;
  hudKey = right;
  mapCredit.textContent = right;
}

// ---------- frame ----------
// Nothing is redrawn while the map stands still and no line is flying.
function draw() {
  frameTime = millis();
  updateShots(frameTime);

  if (mapDirty) {
    mapDirty = false;
    frameNo++;
    drawTiles();      // into mapBuf
    processQueue();   // may set mapDirty again
  }

  if (frameDirty || DOTS.length) {
    frameDirty = false;
    if (posDirty) updatePinPositions();
    renderHud();
    ctx.drawImage(mapBuf, 0, 0, width, height);
    drawTrails(frameTime);
    drawMarkers();
  }
  requestAnimationFrame(draw);
}

resizeCanvas();
setupInput();
setupMapFilters();
fitHome();
window.addEventListener('resize', () => { resizeCanvas(); fitHome(); keepDesktopWindowsInView(); });
requestAnimationFrame(draw);   // the map starts right away, the pins appear once the CSV is loaded
Promise.all([loadMarkers(), loadPinSprites()])
  .then(initPins)
  .catch(err => console.error('Could not initialize markers:', err));
