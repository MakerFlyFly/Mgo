import sharp from "sharp";
import { copyFile, mkdir, readFile, unlink, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ids = ["counter", "entrance", ...["happy", "neutral", "thinking", "smug", "surprised", "sorry", "handoff"].map(id => `character/${id}`)];
for (const id of ids) {
  const original = resolve(root, "public", "art", `${id}.png`), master = resolve(root, "art", "masters", `${id}.png`), output = resolve(root, "public", "art", `${id}.webp`);
  if (!original.startsWith(resolve(root, "public", "art") + sep) || !master.startsWith(resolve(root, "art", "masters") + sep)) throw new Error("Unexpected asset path");
  await mkdir(dirname(master), { recursive: true });
  let hasOriginal = true;
  try { await access(original); } catch { hasOriginal = false; }
  if (hasOriginal) {
    try { await copyFile(original, master, constants.COPYFILE_EXCL); } catch (e) { if (e.code !== "EEXIST") throw e; }
    const hash = bytes => createHash("sha256").update(bytes).digest("hex");
    if (hash(await readFile(original)) !== hash(await readFile(master))) throw new Error("The master differs from the original; left both unchanged");
  }
  await sharp(master).webp({ quality: id.includes("/") ? 93 : 89, alphaQuality: 100, effort: 5 }).toFile(output);
  if (hasOriginal) await unlink(original);
  console.log(`Optimized ${id}; original PNG retained in art/masters`);
}
