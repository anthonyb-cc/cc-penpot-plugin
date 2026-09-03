/**
 * CC Palette — Penpot plugin.
 *
 * Runs in Penpot's plugin sandbox, so it has the same `penpot` API as the MCP
 * `execute_code` bridge but without needing it. Edit a seed, click Apply: the
 * ramp is recomputed and every bound shape repainted.
 *
 * The colour ladder is DUPLICATED from scripts/colour.js. It cannot be imported
 * — the sandbox has no module loader and this file must stand alone. If you
 * change a ladder weight, change it in BOTH. `node scripts/dtcg.js` and this
 * plugin producing different ramps is the failure mode to watch for.
 */

const PALETTES = ['primary', 'secondary', 'neutral'];
const STATUS = ['success', 'danger', 'warning', 'info'];
const SEED_NAMES = [...PALETTES.map((p) => `color.${p}`), 'color.white', 'color.black', ...STATUS.map((s) => `color.${s}`)];

/* ---------- Colour maths (OKLCH) ----------
   MIRRORED FROM scripts/colour.js. The sandbox has no module loader, so this is
   a copy — if you retune a number, change it in BOTH and run
   `node scripts/colour.test.js`, which asserts the ramp still reproduces the
   framework's Theme Toolkit output.

   The ladder is fitted to that output: lightness is linear in the seed's own L
   (the light end converges on white, the deep end on an absolute dark surface),
   and chroma follows a fixed curve as a multiple of the seed's chroma. */

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const hexToOklch = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = srgbToLin(((n >> 16) & 255) / 255);
  const g = srgbToLin(((n >> 8) & 255) / 255);
  const b = srgbToLin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
};

const oklchToLinRgb = ({ L, C, h }) => {
  const a = C * Math.cos(h * Math.PI / 180);
  const b = C * Math.sin(h * Math.PI / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
};

const inGamut = (rgb) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/* High-chroma OKLCH frequently falls outside sRGB. Reduce chroma until it fits,
   holding lightness and hue — the same thing a browser does for `oklch()`.
   Clipping the channels instead would shift the hue. */
const oklchToHex = ({ L, C, h }) => {
  let c = C;
  if (!inGamut(oklchToLinRgb({ L, C, h }))) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinRgb({ L, C: mid, h }))) lo = mid; else hi = mid;
    }
    c = lo;
  }
  const rgb = oklchToLinRgb({ L, C: c, h })
    .map((v) => Math.round(Math.min(1, Math.max(0, linToSrgb(v))) * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};


/* a, b: lightness as L = a·seedL + b.  cm: chroma as a multiple of seed chroma. */
const LIGHT_STEPS = [
  { a: 0.598, b: 0.391, cm: 0.770 },
  { a: 0.288, b: 0.681, cm: 0.565 },
  { a: 0.090, b: 0.879, cm: 0.350 },
  { a: 0.021, b: 0.961, cm: 0.145 },
  { a: 0.000, b: 0.990, cm: 0.050 },
  { a: 0.000, b: 1.000, cm: 0.000 },
];
const DARK_STEPS = [
  { a: 0.844, b: 0.034, cm: 0.960 },
  { a: 0.580, b: 0.100, cm: 0.805 },
  { a: 0.258, b: 0.196, cm: 0.640 },
  { a: 0.066, b: 0.252, cm: 0.535 },
  { a: 0.000, b: 0.301, cm: 0.240 },
  { a: 0.000, b: 0.232, cm: 0.135 },
];
/* Status surfaces are a pale tint, matching the framework's color-mix(15%, white). */
const SURFACE_STEP = { a: 0.055, b: 0.930, cm: 0.130 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const step = (seed, st) => oklchToHex({ L: clamp01(st.a * seed.L + st.b), C: seed.C * st.cm, h: seed.h });


const buildRamp = (seedHex) => {
  const seed = hexToOklch(seedHex);
  const out = {};
  LIGHT_STEPS.forEach((st, i) => { out[`l-${i + 1}`] = step(seed, st); });
  DARK_STEPS.forEach((st, i) => { out[`d-${i + 1}`] = step(seed, st); });
  return out;
};
const surface = (seedHex) => step(hexToOklch(seedHex), SURFACE_STEP);

/* ---------- Token helpers ---------- */

const catalog = () => penpot.library.local.tokens;

const allTokens = () => {
  const out = {};
  for (const set of catalog().sets) for (const t of set.tokens) out[t.name] = t;
  return out;
};

const activeTokens = () => {
  const out = {};
  for (const set of catalog().sets) { if (!set.active) continue; for (const t of set.tokens) out[t.name] = t; }
  return out;
};

const readSeeds = () => {
  const tokens = allTokens();
  return SEED_NAMES
    .filter((n) => tokens[n])
    .map((n) => ({ name: n, value: String(tokens[n].value).toUpperCase() }));
};

/* ---------- Actions ---------- */

const recompute = (seedOverrides) => {
  const tokens = allTokens();
  const changed = [];

  for (const [name, hex] of Object.entries(seedOverrides || {})) {
    const t = tokens[name];
    if (t && String(t.value).toUpperCase() !== hex.toUpperCase()) { t.value = hex.toUpperCase(); changed.push(name); }
  }

  const set = (name, next) => {
    const t = tokens[name];
    if (!t || String(t.value).toUpperCase() === next) return;
    t.value = next;
    changed.push(name);
  };

  for (const p of PALETTES) {
    const seed = (seedOverrides && seedOverrides[`color.${p}`]) || (tokens[`color.${p}`] && tokens[`color.${p}`].value);
    if (!seed) continue;
    for (const [stepName, hex] of Object.entries(buildRamp(seed))) set(`color.${p}-${stepName}`, hex);
  }

  for (const st of STATUS) {
    const seed = (seedOverrides && seedOverrides[`color.${st}`]) || (tokens[`color.${st}`] && tokens[`color.${st}`].value);
    if (!seed) continue;
    set(`color.${st}-surface`, surface(seed));
  }

  return changed;
};

/* Changing a token's VALUE does not repaint the shapes bound to it, on import or
   on edit. And `applyToken` is a TOGGLE — applying it to a property already
   bound to that token REMOVES the binding. So a stale bound shape needs it
   called twice; a shape that has lost its binding needs it once. Getting this
   wrong strips colour bindings across the file, and a naive drift check then
   reports clean because there is nothing left to compare. */
const repaint = () => {
  const tokens = activeTokens();
  let repainted = 0, rebound = 0;

  const walk = (shape) => {
    for (const [prop, key, colourKey] of [['fill', 'fills', 'fillColor'], ['strokeColor', 'strokes', 'strokeColor']]) {
      const arr = shape[key];
      if (!Array.isArray(arr) || !arr[0] || !arr[0][colourKey]) continue;

      const bound = shape.tokens && shape.tokens[prop];
      const painted = String(arr[0][colourKey]).toUpperCase();

      if (bound) {
        const want = String(tokens[bound] && tokens[bound].resolvedValue).toUpperCase();
        if (!tokens[bound] || painted === want) continue;
        shape.applyToken(tokens[bound], [prop]); // toggles OFF
        shape.applyToken(tokens[bound], [prop]); // and back ON, repainting
        repainted++;
        continue;
      }

      /* Unbound but named after a token: a swatch whose binding was toggled off
         by an earlier bad repair. One call restores it. */
      if (tokens[shape.name]) { shape.applyToken(tokens[shape.name], [prop]); rebound++; }
    }
    (shape.children || []).forEach(walk);
  };

  penpot.currentPage.root.children.forEach(walk);
  return { repainted, rebound };
};

const audit = () => {
  const tokens = activeTokens();
  const stale = [], placeholder = [];
  const walk = (shape) => {
    for (const [prop, key, colourKey] of [['fill', 'fills', 'fillColor'], ['strokeColor', 'strokes', 'strokeColor']]) {
      const arr = shape[key];
      if (!Array.isArray(arr) || !arr[0] || !arr[0][colourKey]) continue;
      const painted = String(arr[0][colourKey]).toUpperCase();
      if (painted === '#B1B2B5') placeholder.push(`${shape.name}.${prop}`);
      const bound = shape.tokens && shape.tokens[prop];
      if (!bound || !tokens[bound]) continue;
      if (painted !== String(tokens[bound].resolvedValue).toUpperCase()) stale.push(`${shape.name}.${prop} → ${bound}`);
    }
    (shape.children || []).forEach(walk);
  };
  penpot.currentPage.root.children.forEach(walk);
  return { stale, placeholder };
};

/* ---------- UI wiring ---------- */

penpot.ui.open('CC Palette', '', { width: 340, height: 620 });

const pushSeeds = () => penpot.ui.sendMessage({ type: 'seeds', seeds: readSeeds() });

penpot.ui.onMessage((msg) => {
  try {
    if (msg.type === 'ready') return pushSeeds();

    if (msg.type === 'apply') {
      const changed = recompute(msg.seeds);
      const painted = repaint();
      pushSeeds();
      return penpot.ui.sendMessage({
        type: 'result',
        text: `${changed.length} token${changed.length === 1 ? '' : 's'} updated · ${painted.repainted} repainted${painted.rebound ? ` · ${painted.rebound} rebound` : ''}`,
      });
    }

    if (msg.type === 'repaint') {
      const painted = repaint();
      return penpot.ui.sendMessage({
        type: 'result',
        text: `${painted.repainted} repainted${painted.rebound ? ` · ${painted.rebound} rebound` : ''}`,
      });
    }

    if (msg.type === 'audit') {
      const { stale, placeholder } = audit();
      return penpot.ui.sendMessage({
        type: 'result',
        text: stale.length || placeholder.length
          ? `${stale.length} stale, ${placeholder.length} unresolved${placeholder.length ? ' (a token value is an expression — Penpot cannot apply those)' : ''}`
          : 'All bound shapes match their tokens.',
      });
    }
  } catch (err) {
    penpot.ui.sendMessage({ type: 'result', text: `Error: ${err && err.message ? err.message : String(err)}` });
  }
});

penpot.on('themechange', pushSeeds);
