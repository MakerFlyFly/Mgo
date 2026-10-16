import sharp from "sharp";
import { resolve } from "node:path";
const frames = Array.from({ length: 15 }, (_, index) => resolve("tmp", "entrance-frames", `${String(index).padStart(2, "0")}.png`));
const delays = frames.map((_, index) => index === 0 ? 1800 : index === 13 ? 1800 : index === 14 ? 2400 : 125);
await sharp(frames, { animated: true, join: { animated: true } }).resize({ width: 960 }).gif({ loop: 0, delay: delays, effort: 5, colours: 128 }).toFile("docs/demo.gif");
const metadata = await sharp("docs/demo.gif", { animated: true }).metadata();
console.log(JSON.stringify({ file: "docs/demo.gif", frames: metadata.pages, width: metadata.width, frameHeight: metadata.pageHeight }));
if (metadata.pages !== frames.length) throw new Error("The recording did not retain all frames");
