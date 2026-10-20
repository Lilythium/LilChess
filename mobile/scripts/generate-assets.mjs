#!/usr/bin/env node
// Regenerates the app icons and splash screens for both native projects from web/public/LJicon.svg.
//
//   npm i --no-save @resvg/resvg-js pngjs      (one-off, from the repo root; nothing is added to package.json)
//   node mobile/scripts/generate-assets.mjs
//
// Output is committed, so this only needs to run when the artwork or the background colour changes.
// The background matches the web client's dark theme (--bg in web/src/app.css) so the launch screen, the icon
// and the first frame of the app are the same colour.
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import process from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(resolve(mobile, "../web/public/LJicon.svg"), "utf8");
const BG = { r: 0x16, g: 0x15, b: 0x12 };
const BG_HEX = "#161512";

const logoCache = new Map();
/** The artwork rendered at an exact pixel height, transparent background. */
function logo(heightPx) {
  const h = Math.max(1, Math.round(heightPx));
  if (!logoCache.has(h)) {
    const rendered = new Resvg(svg, { fitTo: { mode: "height", value: h } }).render();
    logoCache.set(h, PNG.sync.read(rendered.asPng()));
  }
  return logoCache.get(h);
}

/**
 * Compose a size x size or width x height canvas.
 * `logoHeightRatio` is the artwork height as a fraction of the canvas height. `background: false` leaves it transparent.
 * `circle` masks the result to a circle (legacy round launcher icons).
 */
function render({ width, height = width, logoHeightRatio, background = true, circle = false, opaque = false }) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = BG.r;
    png.data[o + 1] = BG.g;
    png.data[o + 2] = BG.b;
    png.data[o + 3] = background ? 255 : 0;
  }
  const art = logo(height * logoHeightRatio);
  const left = Math.round((width - art.width) / 2);
  const top = Math.round((height - art.height) / 2);
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const s = (y * art.width + x) * 4;
      const a = art.data[s + 3] / 255;
      if (a === 0) continue;
      const d = ((top + y) * width + (left + x)) * 4;
      const da = png.data[d + 3] / 255;
      const outA = a + da * (1 - a);
      for (let c = 0; c < 3; c++) {
        png.data[d + c] = Math.round((art.data[s + c] * a + png.data[d + c] * da * (1 - a)) / outA);
      }
      png.data[d + 3] = Math.round(outA * 255);
    }
  }
  if (circle) {
    const r = Math.min(width, height) / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dist = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
        const edge = Math.min(1, Math.max(0, r - dist)); // 1px antialiased edge
        const o = (y * width + x) * 4 + 3;
        png.data[o] = Math.round(png.data[o] * edge);
      }
    }
  }
  if (opaque) for (let i = 0; i < width * height; i++) png.data[i * 4 + 3] = 255;
  return PNG.sync.write(png, { colorType: opaque ? 2 : 6 });
}

function write(relativePath, buffer) {
  const target = resolve(mobile, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  process.stdout.write(`wrote ${relativePath}\n`);
}

// ---- Android -----------------------------------------------------------------------------------------------
const res = "android/app/src/main/res";
// Adaptive icon: 108dp canvas, the launcher shows the inner 66dp. The artwork stays inside that safe zone.
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, scale] of Object.entries(densities)) {
  write(`${res}/mipmap-${name}/ic_launcher_foreground.png`, render({ width: 108 * scale, logoHeightRatio: 0.56, background: false }));
  write(`${res}/mipmap-${name}/ic_launcher.png`, render({ width: 48 * scale, logoHeightRatio: 0.72 }));
  write(`${res}/mipmap-${name}/ic_launcher_round.png`, render({ width: 48 * scale, logoHeightRatio: 0.7, circle: true }));
}
// Legacy full-screen splash (API < 31 draws it as the window background).
const portrait = { mdpi: [320, 480], hdpi: [480, 800], xhdpi: [720, 1280], xxhdpi: [960, 1600], xxxhdpi: [1280, 1920] };
for (const [name, [w, h]] of Object.entries(portrait)) {
  write(`${res}/drawable-port-${name}/splash.png`, render({ width: w, height: h, logoHeightRatio: 0.2 }));
  write(`${res}/drawable-land-${name}/splash.png`, render({ width: h, height: w, logoHeightRatio: 0.34 }));
}
write(`${res}/drawable/splash.png`, render({ width: 480, height: 320, logoHeightRatio: 0.34 }));
write(
  `${res}/values/ic_launcher_background.xml`,
  Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG_HEX}</color>\n</resources>\n`),
);

// ---- iOS ---------------------------------------------------------------------------------------------------
// The App Store rejects icons with an alpha channel, so the icon is written opaque (RGB).
const assets = "ios/App/App/Assets.xcassets";
write(`${assets}/AppIcon.appiconset/AppIcon-512@2x.png`, render({ width: 1024, logoHeightRatio: 0.7, opaque: true }));
const splash = render({ width: 2732, logoHeightRatio: 0.17, opaque: true });
for (const file of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  write(`${assets}/Splash.imageset/${file}`, splash);
}
