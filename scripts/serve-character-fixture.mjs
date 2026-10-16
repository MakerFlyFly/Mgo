// Local UI fixture: synthetic SSE only. Never forwards chat or write requests.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { setTimeout as wait } from "node:timers/promises";
import { newSession, expressionValues } from "../src/lib/domain/types.ts";

const upstream = process.env.MGO_FIXTURE_UPSTREAM || "http://127.0.0.1:3119";
const counts = { chatRequests: 0, realToolCalls: 0, newAssetRequests: 0 };
const lines = {
  shy: "谢、谢谢客人夸我……我会认真值班的。\n（鲸鱼娘垂了垂眼，脸颊微微泛红。）",
  eager: "听到今天的午饭，眼睛就忍不住亮起来啦！\n（鲸鱼娘期待地晃了晃尾巴。）",
  pout: "才没有偷吃薯条，只是认真检查香味而已。\n（鲸鱼娘轻轻鼓起脸颊。）",
  sleepy: "夜班是有一点困，客人想聊什么呢？\n（鲸鱼娘半垂着眼，轻轻眨了一下。）",
};
function serve(port, failArt) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    const json = value => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
    if (url.pathname === "/fixture-stats") { json(counts); return; }
    if (url.pathname === "/api/config") { json({ mode: "demo", model: "character-ui-fixture", requiresVisitorKey: false, deepseekConfigured: false, mcdConfigured: false }); return; }
    if (url.pathname === "/api/session") { json({ session: newSession("demo") }); return; }
    if (url.pathname === "/api/chat" && request.method === "POST") {
      counts.chatRequests++;
      let input = ""; for await (const bytes of request) input += bytes;
      const { message } = JSON.parse(input), emit = event => { if (!response.destroyed) response.write(`data: ${JSON.stringify(event)}\n\n`); };
      response.setHeader("Content-Type", "text/event-stream"); response.setHeader("Cache-Control", "no-store");
      const start = (phase, expression) => { const id = crypto.randomUUID(); emit({ type: "utterance_start", utteranceId: id, phase, expression }); return id; };
      const delta = (id, text) => emit({ type: "utterance_delta", utteranceId: id, text });
      const end = (id, expression, text, final = false) => { const reply = { expression, text, choices: final ? ["继续聊聊"] : [] }; emit({ type: "utterance_end", utteranceId: id, reply }); if (final) emit({ type: "reply", utteranceId: id, reply }); };
      const finish = () => { emit({ type: "done" }); response.end(); };
      if (message.startsWith("表情:")) {
        const expression = message.slice(3), valid = expressionValues.includes(expression) ? expression : "neutral", text = lines[valid] || "客人，我在认真值班。";
        const id = start("final", valid);
        for (let offset = 0; offset < text.length; offset += 3) { delta(id, text.slice(offset, offset + 3)); await wait(70); }
        end(id, valid, text, true); finish(); return;
      }
      const text = "好呀，客人！我来核对一下。\n（鲸鱼娘认真看向柜台机。）", id = start("progress", "eager");
      delta(id, text);
      // A deliberately open utterance tests that token pauses never start idle animation.
      await wait(message.includes("等待") ? 7000 : 500); end(id, "eager", text);
      if (message.includes("中断")) { response.end(); return; }
      if (message.includes("错误")) { await wait(5000); emit({ type: "error", code: "FIXTURE_ERROR", message: "受控测试：查询暂时不可用，未创建订单。" }); finish(); return; }
      if (message.includes("递单")) {
        await wait(4000); const session = newSession("demo");
        session.draft.fulfillment = "pickup"; session.draft.store = { storeCode: "DEMO-FIXTURE", storeName: "模拟表情演示店" }; session.draft.takeWayCode = "takeaway";
        session.draft.items = [{ lineId: "1", productCode: "DEMO-ITEM", name: "模拟汉堡", quantity: 1, options: [] }];
        session.quote = { id: crypto.randomUUID(), revision: 0, fingerprint: "0".repeat(64), productCents: 1000, totalCents: 1000, deliveryCents: 0, tablewareCents: 0, discountCents: 0, lines: [{ name: "模拟汉堡", quantity: 1, subtotalCents: 1000 }], takeWays: [{ code: "takeaway", name: "外带" }], createdAt: new Date().toISOString() };
        emit({ type: "state", session }); await wait(1000);
      } else await wait(12000);
      const finalText = lines.shy, finalId = start("final", "shy"); delta(finalId, finalText); end(finalId, "shy", finalText, true);
      // Keep the server busy after the final reply to test final-expression priority.
      await wait(message.includes("等待") ? 6000 : 1200); finish(); return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
    if (url.pathname.startsWith("/art/character/v3/")) { counts.newAssetRequests++; if (failArt) { response.writeHead(503); response.end("Controlled asset failure"); return; } }
    try {
      const source = await fetch(`${upstream}${request.url}`, { redirect: "manual" });
      response.writeHead(source.status, Object.fromEntries([...source.headers].filter(([name]) => !["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(name))));
      if (source.body) Readable.fromWeb(source.body).pipe(response); else response.end();
    } catch { response.writeHead(502); response.end("Fixture upstream unavailable"); }
  });
  server.listen(port, "127.0.0.1", () => console.log(`Character UI fixture on ${port}; failed art=${failArt}; no real tool calls`));
}
serve(3131, false); serve(3132, true);
