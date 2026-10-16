import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
const base = new URL(process.argv[2] || "http://127.0.0.1:3119");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) throw new Error("This credential-using integration test only accepts a loopback URL");
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) throw new Error("Configure the local DEEPSEEK_API_KEY first; its value is never printed");
let config;
for (let attempt = 0; attempt < 30; attempt++) {
  try { const response = await fetch(new URL("/api/config", base), { signal: AbortSignal.timeout(1000) }); if (response.ok) { config = await response.json(); break; } } catch {}
  await setTimeout(500);
}
assert.ok(config, "The demo server did not become ready");
assert.equal(config.mode, "demo"); assert.equal(config.requiresVisitorKey, true); assert.equal(config.deepseekConfigured, false);
let session = (await (await fetch(new URL("/api/session", base))).json()).session;
const missing = await fetch(new URL("/api/chat", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), message: "你好" }) });
assert.equal(missing.status, 401); assert.equal((await missing.json()).code, "DEEPSEEK_KEY_REQUIRED");
async function send(message) {
  const response = await fetch(new URL("/api/chat", base), {
    method: "POST", signal: AbortSignal.timeout(140000), headers: { "Content-Type": "application/json", origin: base.origin },
    body: JSON.stringify({ requestId: crypto.randomUUID(), message, apiKey, demoState: session, ...(session.quote ? { quoteId: session.quote.id } : {}) }),
  });
  assert.equal(response.status, 200);
  const content = await response.text();
  assert.equal(content.includes(apiKey), false);
  const events = content.split("\n\n").filter(frame => frame.startsWith("data: ")).map(frame => JSON.parse(frame.slice(6)));
  const error = events.find(event => event.type === "error");
  if (error) throw new Error(`Public HTTP integration failed: ${error.code}`);
  const state = events.findLast(event => event.type === "state");
  assert.ok(state); session = state.session;
}
await send("我在上海人民广场，到店自取，选搜索结果第一家门店。一份麦辣鸡腿堡套餐，饮料换无糖可乐，预算30元，柜台取餐。请整理点单并核价。");
assert.equal(session.draft.items.length, 1);
assert.ok(session.draft.items[0].options.some(option => option.includes("无糖")));
await send("取餐方式选择柜台取餐，其他不变，请重新核价。");
assert.equal(session.draft.takeWayCode, "counter"); assert.ok(session.quote);
await send("确认下单");
assert.equal(session.attempt.status, "created"); assert.ok(session.attempt.orderId.startsWith("DEMO-")); assert.equal(session.attempt.paymentUrl, undefined);
const orderId = session.attempt.orderId;
await send("确认下单"); assert.equal(session.attempt.orderId, orderId);
console.log(JSON.stringify({ publicDemoHttp: "passed", statelessRoundTrips: 4, missingVisitorKeyRejected: true, configuredServerKeyNotBorrowed: true, simulatedOrder: true, duplicateConfirmationRetainedOrder: true, noKeyInResponses: true }));
