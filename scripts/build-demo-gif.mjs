import sharp from "sharp";
import { resolve } from "node:path";
const frames = [0, 1, 2, 3].map(index => resolve("tmp", "demo-frames", `${String(index).padStart(2, "0")}.jpg`));
await sharp(frames, { animated: true, join: { animated: true } }).resize({ width: 960 }).gif({ loop: 0, delay: [1800, 1400, 1000, 3000], effort: 5, colours: 128 }).toFile("docs/demo.gif");
const metadata = await sharp("docs/demo.gif", { animated: true }).metadata();
console.log(JSON.stringify({ file: "docs/demo.gif", frames: metadata.pages, width: metadata.width, frameHeight: metadata.pageHeight }));
if (metadata.pages !== frames.length) throw new Error("The recording did not retain all frames");
