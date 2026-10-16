import sharp from "sharp";
import { copyFile, mkdir, writeFile } from "node:fs/promises";

// The anatomy is painted by imagegen; this only aligns and blends that approved patch.
// Originals remain untouched. The larger corrected hand covers the old fingertips;
// source-over blending preserves the original soft transparent shadow behind it.
const ids = ["happy", "neutral", "thinking", "smug", "surprised", "sorry", "handoff"];
const width = 1024, height = 1536;
const polygon = [[60, 359], [124, 331], [157, 330], [190, 344], [212, 371], [226, 400], [223, 421], [209, 432], [189, 409], [157, 416], [69, 412], [59, 390]];
const source = "art/hand-fixes/imagegen-hand-edit.png";
await mkdir("art/masters/character/v2", { recursive: true });
await mkdir("public/art/character/v2", { recursive: true });
await mkdir("docs/screenshots", { recursive: true });
const aligned = await sharp(source).resize(1024, 1024).png().toBuffer();
const crop = await sharp(aligned).extract({ left: 72, top: 182, width: 880, height: 660 }).resize(210, 157).png().toBuffer();
const patch = await sharp({ create: { width, height, channels: 4, background: "#00000000" } }).composite([{ input: crop, left: 55, top: 315 }]).raw().toBuffer();

function maskAt(x, y) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[j], [bx, by] = polygon[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  const value = inside ? Math.min(1, distance / 3) : 0;
  return value * value * (3 - 2 * value);
}
const mask = new Float32Array(width * height);
for (let y = 328; y <= 433; y++) for (let x = 57; x <= 228; x++) mask[y * width + x] = maskAt(x + .5, y + .5);
const report = [];
for (const id of ids) {
  const originalPath = `art/masters/character/${id}.png`, outputPath = `art/masters/character/v2/${id}.png`;
  const original = await sharp(originalPath).ensureAlpha().raw().toBuffer();
  const output = Buffer.from(original);
  if (id !== "handoff") for (let pixel = 0; pixel < mask.length; pixel++) {
    const m = mask[pixel]; if (!m) continue;
    const offset = pixel * 4, oldAlpha = original[offset + 3] / 255, newAlpha = patch[offset + 3] / 255;
    const coverage = newAlpha * m, alpha = oldAlpha * (1 - coverage) + coverage;
    for (let channel = 0; channel < 3; channel++) output[offset + channel] = alpha ? Math.round((original[offset + channel] * oldAlpha * (1 - coverage) + patch[offset + channel] * coverage) / alpha) : original[offset + channel];
    output[offset + 3] = Math.round(alpha * 255);
  }
  let changed = 0, outsideMask = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) if (output.subarray(pixel * 4, pixel * 4 + 4).compare(original.subarray(pixel * 4, pixel * 4 + 4))) {
    changed++; if (!mask[pixel]) outsideMask++;
  }
  if (outsideMask) throw new Error(`${id}: pixels changed outside the hand mask`);
  if (id === "handoff") await copyFile(originalPath, outputPath);
  else await sharp(output, { raw: { width, height, channels: 4 } }).png().toFile(outputPath);
  await sharp(outputPath).webp({ quality: 93, alphaQuality: 100, effort: 5 }).toFile(`public/art/character/v2/${id}.webp`);
  report.push({ id, width, height, changedPixels: changed, changedOutsideMask: outsideMask, status: id === "handoff" ? "Both hands audited; original retained" : "Raised hand replaced; other hand and all other pixels retained" });
}
await writeFile("art/hand-fixes/pixel-audit.json", JSON.stringify({ source, polygon, featherPixels: 3, report }, null, 2) + "\n");
const before = await sharp("art/masters/character/happy.png").extract({ left: 55, top: 325, width: 230, height: 145 }).resize(920, 580).flatten({ background: "#fff8ee" }).png().toBuffer();
const after = await sharp("art/masters/character/v2/happy.png").extract({ left: 55, top: 325, width: 230, height: 145 }).resize(920, 580).flatten({ background: "#fff8ee" }).png().toBuffer();
const labels = Buffer.from('<svg width="1860" height="630"><rect width="1860" height="630" fill="#fff8ee"/><g font-family="Arial,sans-serif" font-size="24" fill="#29465e"><text x="24" y="35">BEFORE</text><text x="964" y="35">AFTER · FIVE DIGITS</text></g></svg>');
await sharp(labels).composite([{ input: before, left: 0, top: 50 }, { input: after, left: 940, top: 50 }]).jpeg({ quality: 94 }).toFile("docs/screenshots/hand-fix-comparison.jpg");
console.log(JSON.stringify(report));
const tiles = [];
for (const [index, id] of ids.entries()) {
  const boxes = id === "handoff" ? [{ left: 305, top: 460, width: 180, height: 150 }, { left: 510, top: 460, width: 165, height: 150 }]
    : [{ left: 55, top: 320, width: 205, height: 140 }, { left: 380, top: 615, width: 160, height: 155 }];
  for (const [hand, box] of boxes.entries()) {
    const input = await sharp(`art/masters/character/v2/${id}.png`).extract(box).resize(345, 220, { fit: "contain", background: "#fff8ee" }).flatten({ background: "#fff8ee" }).png().toBuffer();
    tiles.push({ input, left: hand * 355, top: index * 250 + 27 });
  }
  const input = Buffer.from(`<svg width="700" height="27"><text x="10" y="21" font-family="Arial" font-size="19" fill="#243e50">${index + 1}. ${id}</text></svg>`);
  tiles.push({ input, left: 0, top: index * 250 });
}
await sharp({ create: { width: 710, height: 1750, channels: 4, background: "#fff8ee" } }).composite(tiles).jpeg({ quality: 93 }).toFile("docs/screenshots/hand-audit.jpg");
