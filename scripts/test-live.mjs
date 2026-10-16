import { spawnSync } from "node:child_process";
if (!process.env.DEEPSEEK_API_KEY || !process.env.MCD_MCP_TOKEN) {
  console.error("请先在本地环境变量或 .env.local 配置 DEEPSEEK_API_KEY 和 MCD_MCP_TOKEN。密钥不会输出。"); process.exit(1);
}
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/live.integration.test.ts"], {
  stdio: "inherit", env: { ...process.env, MGO_LIVE_TESTS: "1" },
});
process.exit(result.status ?? 1);
