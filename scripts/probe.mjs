import { mkdir, writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

try { process.loadEnvFile(".env.local"); } catch { /* environment variables also work */ }
const flags = new Set(process.argv.slice(2));
const report = { time: new Date().toISOString(), checks: [] };
if (!flags.size || flags.has("--mcp")) {
  let client;
  try {
    if (!process.env.MCD_MCP_TOKEN) throw new Error("MISSING_CREDENTIAL");
    client = new Client({ name: "mgo-readonly-probe", version: "0.1.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.mcd.cn"), {
      requestInit: { headers: { Authorization: `Bearer ${process.env.MCD_MCP_TOKEN}` } },
    }), { timeout: 20000 });
    const result = await client.listTools();
    report.checks.push({ service: "mcd-mcp", ok: true, tools: result.tools.map(t => t.name) });
    if (flags.has("--schemas")) {
      await mkdir("tmp", { recursive: true });
      await writeFile("tmp/mcp-tools.json", JSON.stringify(result.tools, null, 2));
    }
  } catch (error) {
    report.checks.push({ service: "mcd-mcp", ok: false, code: error?.code ?? error?.status ?? "CONNECTION_FAILED" });
  } finally { await client?.close().catch(() => {}); }
}
if (!flags.size || flags.has("--deepseek")) {
  try {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error("MISSING_CREDENTIAL");
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-flash", thinking: { type: "disabled" }, max_tokens: 64, messages: [{ role: "user", content: "用一句简短中文问候客人。" }] }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) { report.checks.push({ service: "deepseek", ok: false, status: response.status }); }
    else {
      const result = await response.json();
      report.checks.push({ service: "deepseek", ok: true, model: result.model, usage: result.usage, greeting: result.choices?.[0]?.message?.content });
    }
  } catch { report.checks.push({ service: "deepseek", ok: false, code: "CONNECTION_FAILED" }); }
}
console.log(JSON.stringify(report, null, 2));
if (report.checks.some(check => !check.ok)) process.exitCode = 1;
