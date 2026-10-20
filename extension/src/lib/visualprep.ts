/**
 * Layer 3 image preprocessing — the ONLY implementation. Used at runtime (offscreen worker, on
 * chrome.tabs.captureVisibleTab output) and at training time (extension/scripts/render_visual.ts
 * on Playwright screenshots), so the model always sees identically prepared pixels.
 * The model takes raw 0..255 RGB floats; normalisation happens inside the network.
 */
export const VISUAL_SIZE = 160;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * "Login area" crop: a square around the sensitive form, shifted up a little so the logo/brand
 * header above the form is included. Input in CSS pixels; output in image pixels.
 */
export function loginCrop(
  form: Rect,
  viewport: { width: number; height: number },
  dpr: number,
  image: { width: number; height: number },
): Rect {
  const side = Math.min(Math.max(Math.max(form.width, form.height) * 1.6, 320), viewport.width, viewport.height);
  let cx = form.x + form.width / 2;
  let cy = form.y + form.height / 2 - side * 0.15;
  cx = Math.min(Math.max(cx, side / 2), viewport.width - side / 2);
  cy = Math.min(Math.max(cy, side / 2), viewport.height - side / 2);
  const x = Math.max(0, Math.round((cx - side / 2) * dpr));
  const y = Math.max(0, Math.round((cy - side / 2) * dpr));
  const s = Math.round(side * dpr);
  return { x, y, width: Math.min(s, image.width - x), height: Math.min(s, image.height - y) };
}

/**
 * Crop + area-average (box filter) resize of RGBA pixels to out x out RGB (uint8, rounded).
 * Each output pixel is the coverage-weighted mean of the source pixels under it, so downscaling
 * never aliases thin text strokes the way nearest-neighbour would.
 */
export function cropResizeRGB(rgba: ArrayLike<number>, width: number, rect: Rect, out = VISUAL_SIZE): Uint8Array {
  const dst = new Uint8Array(out * out * 3);
  const sx = rect.width / out;
  const sy = rect.height / out;
  for (let oy = 0; oy < out; oy++) {
    const y0 = rect.y + oy * sy;
    const y1 = y0 + sy;
    for (let ox = 0; ox < out; ox++) {
      const x0 = rect.x + ox * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let wsum = 0;
      for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
        const wy = Math.min(y1, py + 1) - Math.max(y0, py);
        if (wy <= 0) continue;
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
          const wx = Math.min(x1, px + 1) - Math.max(x0, px);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (py * width + px) * 4;
          r += rgba[i] * w;
          g += rgba[i + 1] * w;
          b += rgba[i + 2] * w;
          wsum += w;
        }
      }
      const o = (oy * out + ox) * 3;
      dst[o] = Math.round(r / wsum);
      dst[o + 1] = Math.round(g / wsum);
      dst[o + 2] = Math.round(b / wsum);
    }
  }
  return dst;
}

/** HWC uint8 RGB -> CHW float32 [1, 3, out, out] model input (values 0..255). */
export function toTensorCHW(rgb: Uint8Array, out = VISUAL_SIZE): Float32Array {
  const t = new Float32Array(3 * out * out);
  const plane = out * out;
  for (let i = 0; i < plane; i++) {
    t[i] = rgb[i * 3];
    t[plane + i] = rgb[i * 3 + 1];
    t[2 * plane + i] = rgb[i * 3 + 2];
  }
  return t;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}
