/**
 * Draws the demo company's logo, stamp and signature (all fictional) and
 * writes them as PNG data URLs to src/db/demo/images.ts. Uses the Chromium
 * that Playwright installs; fonts come from src/pdf/fonts.
 *
 *   node scripts/make-demo-images.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const fonts = resolve('src/pdf/fonts');
// Fonts are inlined: a page set with setContent can't load file URLs.
const font = (family, file, weight) =>
  `@font-face { font-family: '${family}'; font-weight: ${weight};
    src: url(data:font/ttf;base64,${readFileSync(join(fonts, file)).toString('base64')}); }`;
const FONTS = [
  font('Inter', 'inter-600.ttf', 600),
  font('Inter', 'inter-800.ttf', 800),
  font('Plex Arabic', 'plexarabic-600.ttf', 600),
  font('Plex Arabic', 'plexarabic-700.ttf', 700),
].join('\n');

const TEAL = '#0f766e';
const SAND = '#f59e0b';
const INK = '#1e40af';

const LOGO = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="180" viewBox="0 0 720 180">
  <defs>
    <clipPath id="mark"><rect x="10" y="15" width="150" height="150" rx="34"/></clipPath>
  </defs>
  <g clip-path="url(#mark)">
    <rect x="10" y="15" width="150" height="150" fill="${TEAL}"/>
    <circle cx="85" cy="96" r="31" fill="${SAND}"/>
    <rect x="10" y="96" width="150" height="70" fill="${TEAL}"/>
    <path d="M24 108 C 46 94, 64 94, 85 108 S 124 122, 146 108" stroke="#fff" stroke-width="9"
      fill="none" stroke-linecap="round"/>
    <path d="M24 136 C 46 122, 64 122, 85 136 S 124 150, 146 136" stroke="#5eead4"
      stroke-width="9" fill="none" stroke-linecap="round"/>
  </g>
  <text x="186" y="84" font-family="Inter" font-weight="800" font-size="52" fill="#0f172a"
    letter-spacing="-1.4">Rawdat Al Khaleej</text>
  <text x="187" y="138" font-family="Plex Arabic" font-weight="700" font-size="36"
    fill="${TEAL}">روضة الخليج</text>
  <text x="408" y="131" font-family="Inter" font-weight="600" font-size="17" fill="#64748b"
    letter-spacing="2.2">TRADING &amp; CONTRACTING</text>
</svg>`;

const STAMP = `
<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360">
  <defs>
    <path id="top" d="M 46 180 A 134 134 0 0 1 314 180"/>
    <path id="bottom" d="M 36 180 A 144 144 0 0 0 324 180"/>
  </defs>
  <g transform="rotate(-9 180 180)" fill="none" stroke="${INK}" opacity="0.86">
    <circle cx="180" cy="180" r="172" stroke-width="7"/>
    <circle cx="180" cy="180" r="162" stroke-width="2.5"/>
    <circle cx="180" cy="180" r="100" stroke-width="2.5"/>
    <text font-family="Plex Arabic" font-weight="700" font-size="21" fill="${INK}" stroke="none">
      <textPath href="#top" startOffset="50%" text-anchor="middle">روضة الخليج للتجارة العامة والمقاولات</textPath>
    </text>
    <text font-family="Inter" font-weight="800" font-size="14.5" fill="${INK}" stroke="none"
      letter-spacing="0.6">
      <textPath href="#bottom" startOffset="50%" text-anchor="middle">RAWDAT AL KHALEEJ TRADING &amp; CONTRACTING</textPath>
    </text>
    <text x="180" y="163" text-anchor="middle" font-family="Plex Arabic" font-weight="700"
      font-size="30" fill="${INK}" stroke="none">ذ.م.م</text>
    <text x="180" y="198" text-anchor="middle" font-family="Inter" font-weight="800"
      font-size="22" fill="${INK}" stroke="none" letter-spacing="2">W.L.L.</text>
    <text x="180" y="230" text-anchor="middle" font-family="Inter" font-weight="600"
      font-size="16" fill="${INK}" stroke="none" letter-spacing="1">KUWAIT</text>
    <circle cx="33" cy="186" r="4.5" fill="${INK}" stroke="none"/>
    <circle cx="327" cy="186" r="4.5" fill="${INK}" stroke="none"/>
  </g>
</svg>`;

const SIGNATURE = `
<svg xmlns="http://www.w3.org/2000/svg" width="440" height="160" viewBox="0 0 440 160">
  <g fill="none" stroke="#1e3a8a" stroke-linecap="round" stroke-linejoin="round">
    <path stroke-width="4.4" d="M34 118 C 40 84, 58 40, 80 36 C 98 33, 92 70, 74 96 C 64 110, 52 116,
      58 104 C 68 86, 100 74, 118 82 C 130 88, 112 110, 124 112 C 138 114, 150 84, 164 86
      C 176 88, 160 112, 174 114 C 190 116, 204 70, 220 66 C 234 63, 222 104, 236 108
      C 250 112, 262 88, 276 90 C 288 92, 280 112, 294 112 C 312 112, 330 86, 348 84"/>
    <path stroke-width="4" d="M348 84 C 360 83, 356 100, 368 98 C 378 96, 386 88, 392 84"/>
    <path stroke-width="3" d="M46 136 C 130 126, 250 122, 404 128"/>
    <circle cx="204" cy="46" r="3.2" fill="#1e3a8a" stroke="none"/>
  </g>
</svg>`;

async function render(page, svg, width, height) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
      html,body{margin:0;background:transparent}</style></head><body>${svg}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width, height } });
}

/** Shrinks a PNG to 64 colours (keeping its transparency) with ImageMagick, when it is there. */
function squeeze(png, dir, name) {
  const input = join(dir, `${name}.png`);
  const output = join(dir, `${name}-small.png`);
  writeFileSync(input, png);
  try {
    execFileSync('convert', [
      input,
      '-strip',
      '+dither',
      '-colors',
      '64',
      '-define',
      'png:compression-level=9',
      output,
    ]);
    return readFileSync(output);
  } catch {
    return png;
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const dir = mkdtempSync(join(tmpdir(), 'demo-images-'));
const images = {
  logo: squeeze(await render(page, LOGO, 720, 180), dir, 'logo'),
  stamp: squeeze(await render(page, STAMP, 360, 360), dir, 'stamp'),
  signature: squeeze(await render(page, SIGNATURE, 440, 160), dir, 'signature'),
};
await browser.close();

const url = (png) => `data:image/png;base64,${png.toString('base64')}`;
const target = resolve('src/db/demo/images.ts');
writeFileSync(
  target,
  `/**
 * The demo company's logo, stamp and signature: fictional, drawn by
 * scripts/make-demo-images.mjs. PNG data URLs, stored with the company.
 */
export const DEMO_IMAGES = {
  logo: '${url(images.logo)}',
  stamp: '${url(images.stamp)}',
  signature: '${url(images.signature)}',
};
`,
);
execFileSync('npx', ['prettier', '--write', target]);
for (const [name, png] of Object.entries(images)) {
  writeFileSync(join(dir, `${name}-final.png`), png);
  console.log(`${name}: ${png.length} bytes (${join(dir, `${name}-final.png`)})`);
}
