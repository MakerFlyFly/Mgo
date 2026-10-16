import { z } from "zod";
import { runAgent } from "@/lib/agent/engine";
import { DeepSeekModel } from "@/lib/agent/model";
import { MgoError, publicError } from "@/lib/domain/errors";
import { confirmOrder, isExplicitConfirmation } from "@/lib/domain/orders";
import { money, newSession, type AgentReply, type Emit, type Session } from "@/lib/domain/types";
import { McdOrderingProvider } from "@/lib/providers/mcp";
import { MockOrderingProvider } from "@/lib/providers/mock";
import { configuration } from "@/lib/server/config";
import { checkOrigin, cookieHeader, noStoreHeaders, sessionCookie } from "@/lib/server/http";
import { LiveRepository, MemoryJournal } from "@/lib/server/repository";
import { chatRequestSchema } from "@/lib/server/validation";
import { AgentTrace } from "@/lib/agent/trace";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  let repository: LiveRepository | undefined;
  let leasedId: string | undefined;
  let trace: AgentTrace | undefined;
  try {
    checkOrigin(request);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new MgoError("CONTENT_TYPE", "请使用 JSON 请求。", 415);
    if (Number(request.headers.get("content-length") || 0) > 1_500_000) throw new MgoError("TOO_LARGE", "这次对话内容太长，请开启新点单。", 413);
    const rawBody = await request.text();
    if (rawBody.length > 1_500_000) throw new MgoError("TOO_LARGE", "这次对话内容太长，请开启新点单。", 413);
    const body = chatRequestSchema.parse(JSON.parse(rawBody)), config = configuration();
    trace = new AgentTrace(body.requestId, config.mode);
    let session: Session;
    if (config.mode === "live") {
      if (!config.deepseekKey) throw new MgoError("LOCAL_CONFIGURATION", "请在本地配置 DEEPSEEK_API_KEY，然后重启应用。", 503);
      repository = await LiveRepository.open(config.dataDir, config.mcdToken);
      const id = sessionCookie(request);
      session = (id && repository.getSession(id)) || newSession("live");
      await repository.saveSession(session); repository.acquire(session.id); leasedId = session.id;
    } else { session = body.demoState as Session || newSession("demo"); session.mode = "demo"; }
    if (body.reset) {
      if (session.attempt && ["submitting", "unknown"].includes(session.attempt.status)) throw new MgoError("UNRESOLVED_ORDER", "请先核实上一次订单，避免重复点餐。", 409);
      if (repository && leasedId) { repository.release(leasedId); leasedId = undefined; }
      session = newSession(config.mode);
      if (repository) { await repository.saveSession(session); repository.acquire(session.id); leasedId = session.id; }
    }
    if (body.preferences) session.preferences = body.preferences;
    const apiKey = config.mode === "demo" ? body.apiKey || "" : config.deepseekKey;
    if (!body.reset && !body.message.trim()) throw new MgoError("EMPTY_MESSAGE", "写点什么再发给鲸鱼娘吧。");
    if (!body.reset && !apiKey) throw new MgoError("DEEPSEEK_KEY_REQUIRED", "先在设置里填入你的 DeepSeek Key，就可以和我聊天啦。", 401);
    const journal = repository || new MemoryJournal();
    if (!repository && session.attempt) await journal.reserveAttempt(session.attempt);
    const provider = config.mode === "live" ? new McdOrderingProvider(config.mcdToken, trace) : new MockOrderingProvider();
    const liveRepo = repository, lockId = leasedId;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit: Emit = event => { if (event.type === "utterance_delta" && event.text || event.type === "reply") trace?.firstText(); try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* finish persistence even after the browser disconnects */ } };
        const timer = setInterval(() => { try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch {} }, 12000);
        try {
          const signal = AbortSignal.timeout(120000);
          if (body.reset) {
            emit({ type: "state", session });
            emit({ type: "reply", reply: { text: "新的点单夹准备好啦，客人这次想吃点什么？放心，我有在认真值班。", expression: "happy", choices: ["推荐30元以内的一人餐", "我想到店自取", "我想点外送"] } });
          } else if (isExplicitConfirmation(body.message)) {
            emit({ type: "status", text: "正在最后核对价格和点单内容…" });
            const result = await confirmOrder(session, provider, journal, { message: body.message, quoteId: body.quoteId, requestId: body.requestId }, signal);
            let reply: AgentReply;
            if (result.kind === "price_changed") reply = { text: `刚刚重新核价，总价更新为 ${money(result.quote.totalCents)}。新的点单夹已经递给你啦，请重新看一下，再决定是否确认下单。`, expression: "surprised", choices: ["确认下单", "我想调整点单"] };
            else {
              const attempt = result.attempt;
              reply = attempt.status === "created" ? { text: config.mode === "demo" ? "叮！云端点单成功～这是体验订单，不会扣款，也不会配送。要是喜欢这份搭配，下次来还可以找我。" : attempt.paymentUrl ? "点单已经送出啦！请打开麦当劳官方支付页面完成付款。付好后可以再问我订单进度，客人先别急着溜走哦。" : "订单已创建，当前没有可用的官方支付链接。客人可以打开麦当劳官方 App 查看这笔订单并完成付款。", expression: "happy", choices: ["看看订单进度", "谢谢你，辛苦啦"] } : { text: attempt.message || "订单正在提交或核实中，请先查看官方订单，暂时不要重复下单。", expression: "thinking", choices: ["查询近期订单"] };
            }
            session.messages.push({ role: "user", content: body.message }, { role: "assistant", content: reply.text });
            emit({ type: "state", session }); emit({ type: "reply", reply });
          } else {
            emit({ type: "status", text: "深度思考ing" });
            await runAgent(session, provider, new DeepSeekModel(apiKey, config.model), body.message, emit, signal, trace);
          }
        } catch (error) {
          const e = publicError(error);
          emit({ type: "state", session }); emit({ type: "error", code: e.code, message: e.message });
        } finally {
          clearInterval(timer);
          await journal.saveSession(session).catch(() => {});
          await provider.close();
          if (liveRepo && lockId) liveRepo.release(lockId);
          liveRepo?.close();
          trace?.report();
          emit({ type: "done" }); try { controller.close(); } catch {}
        }
      },
    });
    // Ownership of the connection/lease is transferred to the stream's finally block.
    repository = undefined; leasedId = undefined;
    return new Response(stream, { headers: { ...noStoreHeaders, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no", ...(config.mode === "live" ? { "Set-Cookie": cookieHeader(session.id, request) } : {}) } });
  } catch (error) {
    if (repository && leasedId) repository.release(leasedId);
    repository?.close();
    trace?.report();
    const e = error instanceof z.ZodError || error instanceof SyntaxError ? new MgoError("INVALID_REQUEST", "请求内容不完整或格式错误，请刷新后重试。") : publicError(error);
    return Response.json({ error: e.message, code: e.code }, { status: e.status, headers: noStoreHeaders });
  }
}
