import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
try { process.loadEnvFile(".env.local"); } catch {}
const secrets = [process.env.DEEPSEEK_API_KEY, process.env.MCD_MCP_TOKEN].filter(value => value && value.length >= 8);
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const failures = [];
for (const file of files) {
  if (/(^|\/)(\.env(?!\.example$)|\.data\/|tmp\/|node_modules\/|\.next\/|\.vercel\/)/.test(file) || /\.db(?:-|$)/.test(file)) failures.push(`${file}: private runtime file`);
  const info = await stat(file);
  if (info.size > 95_000_000) failures.push(`${file}: oversized file`);
  if (/\.(png|jpe?g|webp|gif|ico|woff2?)$/i.test(file)) continue;
  const content = await readFile(file, "utf8");
  if (secrets.some(secret => content.includes(secret))) failures.push(`${file}: credential detected (value hidden)`);
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`Checked ${files.length} tracked files: no runtime data or configured credentials found.`);
