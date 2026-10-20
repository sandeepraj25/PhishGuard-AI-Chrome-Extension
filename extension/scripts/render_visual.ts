/**
 * Renders ml/data/visual/pages.jsonl with Chromium (Playwright), finds the login form, and applies
 * the SAME crop/resize as the extension (src/lib/visualprep.ts). Writes 112x112 PNGs + index.csv.
 *   npx tsx scripts/render_visual.ts ../ml/data/visual/pages.jsonl ../ml/data/visual
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

import { cropResizeRGB, loginCrop, VISUAL_SIZE } from '../src/lib/visualprep';

const [inPath, outDir] = process.argv.slice(2);
if (!inPath || !outDir) throw new Error('usage: render_visual.ts <pages.jsonl> <outDir>');
mkdirSync(resolve(outDir, 'img'), { recursive: true });

export function rgbToPng(rgb: Uint8Array, size = VISUAL_SIZE): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i++) {
    png.data[i * 4] = rgb[i * 3];
    png.data[i * 4 + 1] = rgb[i * 3 + 1];
    png.data[i * 4 + 2] = rgb[i * 3 + 2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

const rows = readFileSync(inPath, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { id: string; label: string; role: string; split: string; html: string });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const index = ['id,label,role,split,path'];
for (const row of rows) {
  await page.setContent(row.html, { waitUntil: 'load' });
  const box = await page.locator('form').first().boundingBox();
  if (!box) continue;
  const shot = PNG.sync.read(await page.screenshot({ type: 'png' }));
  const rect = loginCrop(box, { width: 1280, height: 800 }, 1, { width: shot.width, height: shot.height });
  const rgb = cropResizeRGB(shot.data, shot.width, rect);
  const path = `img/${row.id}.png`;
  writeFileSync(resolve(outDir, path), rgbToPng(rgb));
  index.push([row.id, row.label, row.role, row.split, path].join(','));
}
await browser.close();
writeFileSync(resolve(outDir, 'index.csv'), index.join('\n') + '\n');
console.log(`rendered ${index.length - 1} pages -> ${outDir}`);
