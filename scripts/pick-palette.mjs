/**
 * Snap the chart ramp into the lightness band the dataviz validator requires,
 * separately for each theme.
 *
 * The Snowball-derived ramp already passes the two checks that are hardest to
 * satisfy — colour-vision separation and the normal-vision floor. Generating a
 * palette from scratch scored worse on both. So this keeps each colour's hue and
 * chroma and moves only its lightness, which is what was actually out of range,
 * then re-validates.
 *
 * The dark theme gets its own steps rather than a flipped copy of the light
 * ones: its band is narrower (0.48–0.67 against 0.43–0.77) and its surface is
 * far from black, so one set of hexes cannot serve both.
 *
 *   node scripts/pick-palette.mjs
 */
import { contrast, validate } from "./vendor/validate-palette.js";

const SOURCE = ["#3699ff", "#8950fc", "#1bc5bd", "#6930c3", "#ffa800", "#f64e60", "#187de4", "#0bb7af"];
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] };
const SURFACE = { light: "#ffffff", dark: "#32323e" };

// ---- sRGB <-> OKLCH (Björn Ottosson) -----------------------------------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToOklch(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}

function oklchToHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const inGamut = rgb.every((v) => v >= -0.001 && v <= 1.001);
  const hex =
    "#" +
    rgb.map((v) => Math.round(clamp01(toSrgb(clamp01(v))) * 255).toString(16).padStart(2, "0")).join("");
  return { hex, inGamut };
}

/** Keep the hue, keep as much chroma as the gamut allows at the new lightness. */
function atLightness(hex, L) {
  const [, C, h] = hexToOklch(hex);
  for (let c = C; c > 0.02; c -= 0.005) {
    const candidate = oklchToHex(L, c, h);
    if (candidate.inGamut) return candidate.hex;
  }
  return oklchToHex(L, 0.1, h).hex;
}

/*
 * The third state matters: the validator reports `false` for a hard failure but
 * the string "relief" for a contrast warning, which is satisfied by the labels
 * and figures printed beside every chart. Treating any truthy value as a pass
 * is exactly how a failing palette gets shipped.
 */
const statusOf = (ok) =>
  ok === true || ok === "pass" ? "PASS" : isFailure(ok) ? "FAIL" : String(ok).toUpperCase();
/* A hard failure arrives as `false` for some checks and the string "fail" for
 * others. Checking only for `false` silently counts a failed palette as clean. */
function isFailure(ok) {
  return ok === false || ok === "fail";
}

/**
 * Compress the source ramp's own lightness spread into the target band instead
 * of flattening it.
 *
 * Flattening every colour to one lightness looked principled — equal visual
 * weight for equal-rank series — and destroyed the thing that mattered: deutan
 * separation fell from 8.3 to 3.9, because red-green confusion is resolved
 * largely by lightness difference. The spread is load-bearing, so keep its
 * shape and only move and scale it.
 */
function snap(mode) {
  const [lo, hi] = BAND[mode];
  const surface = SURFACE[mode];

  const sourceL = SOURCE.map((hex) => hexToOklch(hex)[0]);
  const minL = Math.min(...sourceL);
  const maxL = Math.max(...sourceL);
  const span = maxL - minL || 1;

  let best = null;

  const score = (ramp) => {
    const { report } = validate(ramp, { mode, surface });
    const num = (needle) =>
      Number((report.find((r) => r[0].includes(needle))?.[2].match(/ΔE ([\d.]+)/) ?? [0, 0])[1]);
    return {
      report,
      failures: report.filter(([, ok]) => isFailure(ok)).length,
      cvd: num("CVD"),
      normal: num("Normal"),
      // Worst legibility of any single swatch against the card behind it.
      minContrast: Math.min(...ramp.map((hex) => contrast(hex, surface))),
    };
  };

  /*
   * Order of preference: no hard failures, then enough colour-vision separation
   * to clear the floor, then the most legible swatch set. Optimising separation
   * alone produced a dark ramp whose worst swatch sat at 1.74 against the card —
   * technically compliant, practically invisible.
   */
  const better = (a, b) => {
    if (!b) return true;
    if (a.failures !== b.failures) return a.failures < b.failures;
    const aClears = a.cvd >= 8;
    const bClears = b.cvd >= 8;
    if (aClears !== bClears) return aClears;
    if (aClears && bClears) return a.minContrast > b.minContrast;
    return a.cvd > b.cvd;
  };

  for (let a = lo; a <= hi - 0.04; a += 0.02) {
    for (let b = a + 0.04; b <= hi; b += 0.02) {
      const shifted = SOURCE.map((hex, i) =>
        atLightness(hex, a + ((sourceL[i] - minL) / span) * (b - a)),
      );

      /*
       * Which colours sit next to each other is a free variable — the checker
       * only ever compares adjacent pairs. Violet beside blue was the worst
       * pair in every window, and it costs nothing to move it. Random restarts
       * beat hand-ordering here for the same reason hand-picking hexes failed.
       */
      for (let attempt = 0; attempt < 160; attempt++) {
        const ramp = attempt === 0 ? shifted : shuffle(shifted);
        const result = { ...score(ramp), ramp, L: `${a.toFixed(2)}–${b.toFixed(2)}` };
        if (better(result, best)) best = result;
      }
    }
  }
  return best;
}

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

for (const mode of ["light", "dark"]) {
  const result = snap(mode);
  console.log(`\n=== ${mode.toUpperCase()} · поверхность ${SURFACE[mode]} · L=${result.L} ===`);
  console.log(result.ramp.join(","));
  for (const [name, ok, detail] of result.report) {
    console.log(`  [${statusOf(ok).padEnd(6)}] ${name.padEnd(21)} ${detail.slice(0, 104)}`);
  }
  console.log(
    (result.failures === 0 ? "  → жёстких провалов нет" : `  → провалов: ${result.failures}`) +
      ` · худший контраст ${result.minContrast.toFixed(2)}:1 · ΔE ${result.cvd}`,
  );
}
