import { describe, expect, it } from 'vitest';

import { decide, type VisualGallery } from '../../src/lib/visualscore';
import { cosine, cropResizeRGB, loginCrop, toTensorCHW } from '../../src/lib/visualprep';

describe('visual preprocessing', () => {
  it('login crop is square, includes the area above the form and stays inside the image', () => {
    const r = loginCrop({ x: 500, y: 300, width: 300, height: 200 }, { width: 1280, height: 800 }, 2, {
      width: 2560,
      height: 1600,
    });
    expect(r.width).toBe(r.height);
    expect(r.width).toBe(Math.round(480 * 2)); // 1.6 x 300 css px at dpr 2
    expect(r.y).toBeLessThan(300 * 2); // starts above the form
    const edge = loginCrop({ x: 0, y: 0, width: 50, height: 50 }, { width: 1280, height: 800 }, 1, {
      width: 1280,
      height: 800,
    });
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
  });

  it('area-average resize: uniform input stays uniform; 2x2 blocks average exactly', () => {
    const w = 4;
    const rgba = new Uint8Array(w * w * 4);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        rgba[i] = x < 2 ? 0 : 200; // left half black, right half 200
        rgba[i + 1] = 100;
        rgba[i + 2] = (x + y) % 2 ? 255 : 0; // checkerboard averages to 127.5 -> 128
      }
    const out = cropResizeRGB(rgba, w, { x: 0, y: 0, width: 4, height: 4 }, 2);
    expect(Array.from(out)).toEqual([0, 100, 128, 200, 100, 128, 0, 100, 128, 200, 100, 128]);
    const t = toTensorCHW(out, 2);
    expect(Array.from(t.slice(0, 4))).toEqual([0, 200, 0, 200]); // R plane
  });

  it('gallery decision rules', () => {
    const g: VisualGallery = {
      version: 1,
      size: 160,
      rule: 'nn',
      threshold: 0.9,
      scale: 10,
      prototypes: [
        [1, 0],
        [0, 1],
      ],
      brands: [
        { id: 'examplebank', name: 'ExampleBank', official_domains: ['examplebank.test'], embeddings: [[1, 0]] },
      ],
    };
    expect(decide([0.99, 0.141], g)).toMatchObject({ index: 0 });
    expect(decide([1, 0], { ...g, rule: 'proto' }).index).toBe(0);
    expect(decide([0, 1], { ...g, rule: 'proto' }).index).toBe(-1); // "other" wins
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
});
