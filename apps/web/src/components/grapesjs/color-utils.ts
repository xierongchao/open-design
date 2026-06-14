/**
 * Color conversion utilities for the StylePanel color editor.
 *
 * Supports hex / rgb / hsv / hsl interconversion plus alpha, and an
 * EyeDropper API wrapper (Chrome/Edge only, with graceful fallback).
 */

export interface RGB {
  r: number; // 0-255
  g: number;
  b: number;
}

export interface RGBA extends RGB {
  a: number; // 0-1
}

export interface HSV {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

export interface ColorValue {
  hsv: HSV;
  a: number; // alpha 0-1
}

// ─── Parsing ──────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join(''); // #rgba → rgb
  const num = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbaToHex({ r, g, b, a }: RGBA): string {
  const base = rgbToHex({ r, g, b });
  if (a >= 1) return base;
  const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0');
  return `${base}${alphaHex}`;
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hh = ((h % 360) + 360) % 360 / 60;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const vv = Math.max(0, Math.min(100, v)) / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = vv - c;
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; }
  else if (hh < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
}

export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0));
    else if (max === gg) h = ((bb - rr) / d + 2);
    else h = ((rr - gg) / d + 4);
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hh = ((h % 360) + 360) % 360;
  const ss = s / 100;
  const ll = l / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) { r = c; g = x; }
  else if (hh < 120) { r = x; g = c; }
  else if (hh < 180) { g = c; b = x; }
  else if (hh < 240) { g = x; b = c; }
  else if (hh < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

// ─── CSS string parsing ───────────────────────────────────────────────────

/** Parse any CSS color string (hex/rgb/rgba/named) into RGBA. */
export function parseCssColor(css: string): RGBA {
  const v = css.trim();
  if (!v || v === 'none' || v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  // hex
  if (v.startsWith('#')) {
    const rgb = hexToRgb(v);
    let a = 1;
    const h = v.replace('#', '');
    if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
    else if (h.length === 4) a = parseInt(h[3]! + h[3]!, 16) / 255;
    return { ...rgb, a };
  }
  // rgb()/rgba()
  const m = v.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s]+([\d.]+))?\s*\)/i);
  if (m) {
    return {
      r: parseFloat(m[1] ?? '0'),
      g: parseFloat(m[2] ?? '0'),
      b: parseFloat(m[3] ?? '0'),
      a: m[4] !== undefined ? parseFloat(m[4]) : 1,
    };
  }
  // hsl/hsla
  const hm = v.match(/hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,\s]+([\d.]+))?\s*\)/i);
  if (hm) {
    const rgb = hslToRgb(parseFloat(hm[1] ?? '0'), parseFloat(hm[2] ?? '0'), parseFloat(hm[3] ?? '0'));
    return { ...rgb, a: hm[4] !== undefined ? parseFloat(hm[4]) : 1 };
  }
  // named colors — use a canvas to resolve
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = v;
      const hex = ctx.fillStyle; // browser normalizes to #rrggbb or rgba(...)
      if (hex.startsWith('#')) {
        const rgb = hexToRgb(hex);
        return { ...rgb, a: 1 };
      }
      return parseCssColor(hex);
    }
  } catch {
    // ignore — not in a browser
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/** Convert RGBA to a CSS string (hex if opaque, rgba() if has alpha). */
export function rgbaToCss({ r, g, b, a }: RGBA): string {
  if (a >= 1) return rgbToHex({ r, g, b });
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.round(a * 100) / 100})`;
}

/** Convert a ColorValue (HSV + alpha) to a CSS string. */
export function colorValueToCss(cv: ColorValue): string {
  const rgb = hsvToRgb(cv.hsv);
  return rgbaToCss({ ...rgb, a: cv.a });
}

/** Parse a CSS color string into a ColorValue (HSV + alpha). */
export function parseCssToColorValue(css: string): ColorValue {
  const rgba = parseCssColor(css);
  return { hsv: rgbToHsv({ r: rgba.r, g: rgba.g, b: rgba.b }), a: rgba.a };
}

// ─── EyeDropper API ──────────────────────────────────────────────────────

/**
 * Open the browser EyeDropper color picker. Returns the hex color or null
 * if unsupported / cancelled. Chrome/Edge 95+ only.
 */
export async function pickColorWithEyedropper(): Promise<string | null> {
  type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
  const w = typeof window !== 'undefined' ? (window as unknown as { EyeDropper?: EyeDropperCtor }) : undefined;
  if (!w?.EyeDropper) return null;
  try {
    const result = await new w.EyeDropper().open();
    return result.sRGBHex;
  } catch {
    return null; // user cancelled
  }
}

export function isEyeDropperSupported(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { EyeDropper?: unknown }).EyeDropper;
}
