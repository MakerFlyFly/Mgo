import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
try { process.loadEnvFile(".env.local"); } catch {}
const base = process.argv[2] || "http://127.0.0.1:3118";
const output = process.argv[3] || "tmp/chat-benchmark.json";
const samples = Number(process.argv[4] || 3);
const config = await (await fetch(`${base}/api/config`)).json();
const scenarios = [
  ["chat", "你好，请用一句短话打个招呼，不点餐、不查询门店、不修改点单。"],
  ["find-store", "我在上海人民广场，想自取，先帮我查附近餐厅供我选择，不选店、不下单。"],
];
const results = [];
for (const [scenario, message] of scenarios) for (let sample = 1; sample <= samples; sample++) {
  const initial = await fetch(`${base}/api/session`), state = await initial.json();
  const cookie = initial.headers.get("set-cookie")?.split(";")[0];
  const start = performance.now();
  const response = await fetch(`${base}/api/chat`, { method: "POST", signal: AbortSignal.timeout(125000), headers: { origin: base, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ message, requestId: crypto.randomUUID(), ...(config.mode === "demo" ? { apiKey: process.env.DEEPSEEK_API_KEY, demoState: state.session } : {}) }) });
  if (!response.ok) throw new Error(`Benchmark HTTP ${response.status}`);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", firstTextMs = null, firstReplyMs = null, progress = 0, failure, storeCount = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
      if (!frame.startsWith("data: ")) continue;
      const event = JSON.parse(frame.slice(6)), at = Math.round(performance.now() - start);
      if (event.type === "utterance_delta" && event.text) firstTextMs ??= at;
      if (event.type === "utterance_start" && event.phase === "progress") progress++;
      if (event.type === "reply") { firstTextMs ??= at; firstReplyMs ??= at; }
      if (event.type === "error") failure = event.code;
      if (event.type === "state" && event.session.attempt) throw new Error("Read-only benchmark unexpectedly contains an order attempt");
      if (event.type === "state") storeCount = Object.keys(event.session.stores || {}).length;
    }
  }
  if (failure || firstReplyMs === null || scenario === "find-store" && !storeCount) throw new Error(`Benchmark did not complete the expected ${scenario} operation${failure ? ` (${failure})` : ""}`);
  const result = { scenario, sample, firstTextMs, firstReplyMs, totalMs: Math.round(performance.now() - start), progress, ...(failure ? { error: failure } : {}) };
  results.push(result); console.log(JSON.stringify(result));
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ mode: config.mode, model: config.model, samples, results }, null, 2) + "\n");
}
