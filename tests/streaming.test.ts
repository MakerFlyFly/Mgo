import { afterEach, describe, expect, it, vi } from "vitest";
import { topLevelStringPrefix } from "@/lib/streaming/json-text";
import { sseData } from "@/lib/streaming/sse";
import { DeepSeekModel, type ModelToolDelta, type ModelClient } from "@/lib/agent/model";
import { runAgent } from "@/lib/agent/engine";
import { newSession, type ModelMessage, type StreamEvent } from "@/lib/domain/types";
import { MockOrderingProvider } from "@/lib/providers/mock";
import { DialoguePlayback, stageParts, spokenSlice } from "@/lib/dialogue/playback";

const encoder = new TextEncoder();
function byteStream(text: string) {
  const bytes = encoder.encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
}
function call(name: string, args: unknown, id = crypto.randomUUID()) {
  return { id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } };
}
function assistant(...calls: ReturnType<typeof call>[]): ModelMessage { return { role: "assistant", content: null, tool_calls: calls }; }
const final = () => assistant(call("reply_to_guest", { expression: "happy", text: "客人看看这两家餐厅，想选哪一家？", choices: ["第一家", "第二家"] }));
class StreamingScript implements ModelClient {
  private index = 0;
  constructor(private responses: ModelMessage[]) {}
  async complete(_messages: ModelMessage[], _tools: unknown, _signal?: AbortSignal, onDelta?: (delta: ModelToolDelta) => void) {
    const response = this.responses[this.index++] || final();
    for (const [index, tool] of (response.tool_calls || []).entries()) {
      for (let length = 1; length <= tool.function.arguments.length; length++) onDelta?.({ index, id: tool.id, name: tool.function.name, arguments: tool.function.arguments.slice(0, length) });
    }
    return response;
  }
}
afterEach(() => vi.unstubAllGlobals());

describe("stream transport", () => {
  it("handles CRLF, comments, multi-line SSE data and UTF-8 split at every byte", async () => {
    const result = [];
    for await (const data of sseData(byteStream(': heartbeat\r\n\r\ndata: {"text":\r\ndata: "客人🐋"}\r\n\r\ndata: [DONE]\r\n\r\n'))) result.push(data);
    expect(result).toEqual(['{"text":\n"客人🐋"}', "[DONE]"]);
  });
  it("extracts only a top-level text field and withholds incomplete escapes/surrogates", () => {
    const raw = '{"other":{"text":"秘密"},"expression":"happy","text":"客人\\n\\"你好\\"\\uD83D\\uDC0B","choices":["A"]}';
    let previous = "";
    for (let index = 1; index <= raw.length; index++) {
      const text = topLevelStringPrefix(raw.slice(0, index), "text");
      if (text !== undefined) { expect(text.startsWith(previous)).toBe(true); expect(text).not.toContain("秘密"); expect(/[\uD800-\uDBFF]$/.test(text)).toBe(false); previous = text; }
    }
    expect(previous).toBe('客人\n"你好"🐋');
  });
  it("streams interleaved tool deltas before completion and discards upstream reasoning", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
    const deltas: ModelToolDelta[] = [];
    const result = new DeepSeekModel("test-key", "deepseek-flash").complete([], [], undefined, delta => deltas.push(delta));
    const emit = (delta: unknown, finish_reason: string | null = null) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`));
    emit({ reasoning_content: "private", tool_calls: [{ index: 0, id: "first", function: { name: "narrate_to_guest", arguments: '{"text":"客' } }] });
    await vi.waitFor(() => expect(deltas).toHaveLength(1));
    expect(deltas[0].arguments).toBe('{"text":"客');
    emit({ tool_calls: [{ index: 1, id: "second", function: { name: "query_nearby_stores", arguments: '{"city":' } }] });
    emit({ tool_calls: [{ index: 0, function: { arguments: '人"}' } }, { index: 1, function: { arguments: '"上海"}' } }] });
    emit({}, "tool_calls"); controller.enqueue(encoder.encode("data: [DONE]\n\n")); controller.close();
    const reply = await result;
    expect(reply.tool_calls?.map(tool => tool.id)).toEqual(["first", "second"]);
    expect(reply.tool_calls?.[0].function.arguments).toBe('{"text":"客人"}');
    expect(JSON.stringify(reply)).not.toContain("private");
  });
  it("rejects truncated streams and incomplete JSON before any business tool executes", async () => {
    const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: "x", function: { name: "query_meals", arguments: "{" } }] }, finish_reason: "tool_calls" }] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(byteStream(`data: ${JSON.stringify(chunk)}\n\n`))));
    await expect(new DeepSeekModel("test", "deepseek-flash").complete([], [])).rejects.toMatchObject({ code: "MODEL_STREAM_INTERRUPTED" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(byteStream(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`))));
    await expect(new DeepSeekModel("test", "deepseek-flash").complete([], [])).rejects.toMatchObject({ code: "MODEL_RESPONSE" });
  });
});

describe("streaming agent rules", () => {
  it("does not count invalid narration as permission to start a remote query", async () => {
    const provider = new MockOrderingProvider(), query = vi.spyOn(provider, "callTool");
    const model = new StreamingScript([assistant(call("narrate_to_guest", { expression: "invalid", text: "错误的动作。" }), call("query_nearby_stores", { city: "上海", keyword: "人民广场" })), final()]);
    await runAgent(newSession("demo"), provider, model, "找店", () => {}); expect(query).not.toHaveBeenCalled();
  });
  it("asks the agent to supply a missing process reply before making any MCP query", async () => {
    const provider = new MockOrderingProvider(), query = vi.spyOn(provider, "callTool"), session = newSession("demo");
    const model = new StreamingScript([
      assistant(call("query_nearby_stores", { city: "上海", keyword: "人民广场" })),
      assistant(call("query_nearby_stores", { city: "上海", keyword: "人民广场" }), call("narrate_to_guest", { expression: "happy", text: "好呀，客人！\n（鲸鱼娘敲起柜台机。）" })), final(),
    ]);
    const events: StreamEvent[] = [];
    query.mockImplementation(async () => { expect(events.some(event => event.type === "utterance_delta")).toBe(true); return { data: [] }; });
    await runAgent(session, provider, model, "查餐厅", event => events.push(event));
    expect(query).toHaveBeenCalledOnce(); expect(session.messages.some(message => message.content?.includes("PROCESS_REPLY_REQUIRED"))).toBe(true);
  });
  it("shows process dialogue before a delayed query completes, then appends a final reply", async () => {
    const session = newSession("demo"), provider = new MockOrderingProvider(), actual = provider.callTool.bind(provider);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(provider, "callTool").mockImplementation(async (name, args) => { await gate; return actual(name, args); });
    const events: StreamEvent[] = [];
    const model = new StreamingScript([assistant(call("narrate_to_guest", { expression: "happy", text: "好呀，客人！\n（鲸鱼娘摇摇尾巴，敲起柜台机。）" }), call("query_nearby_stores", { city: "上海市", keyword: "人民广场" })), final()]);
    const running = runAgent(session, provider, model, "查附近餐厅", event => events.push(event));
    await vi.waitFor(() => expect(provider.callTool).toHaveBeenCalledOnce());
    expect(events.filter(event => event.type === "utterance_delta").length).toBeGreaterThan(1);
    expect(events.some(event => event.type === "reply")).toBe(false);
    release(); await running;
    expect(events.filter(event => event.type === "utterance_start").map(event => event.phase)).toEqual(["progress", "final"]);
    const finalEvent = events.find(event => event.type === "reply");
    expect(finalEvent?.utteranceId).toBeTruthy(); expect(session.attempt).toBeNull();
  });
  it("never streams a premature confirmation before the pickup guard replaces it", async () => {
    const session = newSession("demo");
    session.draft.fulfillment = "pickup"; session.draft.store = { storeCode: "x", storeName: "测试店" };
    session.quote = { id: crypto.randomUUID(), revision: 0, fingerprint: "0".repeat(64), productCents: 2550, totalCents: 2550, deliveryCents: 0, tablewareCents: 0, discountCents: 0, lines: [], takeWays: [{ code: "counter", name: "柜台取餐" }], createdAt: new Date().toISOString() };
    const events: StreamEvent[] = [];
    await runAgent(session, new MockOrderingProvider(), new StreamingScript([assistant(call("reply_to_guest", { expression: "happy", text: "直接确认下单。", choices: ["确认下单"] }))]), "看报价", event => events.push(event));
    const text = events.flatMap(event => event.type === "utterance_delta" ? [event.text] : []).join("");
    expect(text).not.toContain("直接确认"); expect(text).toContain("还需要选一下取餐方式");
  });
  it("marks a partial utterance interrupted without retaining incomplete tool history", async () => {
    const session = newSession("demo"), events: StreamEvent[] = [];
    const model: ModelClient = { complete: async (_m, _t, _s, delta) => { delta?.({ index: 0, id: "x", name: "reply_to_guest", arguments: '{"text":"客人，我来' }); throw new Error("lost connection"); } };
    await expect(runAgent(session, new MockOrderingProvider(), model, "你好", event => events.push(event))).rejects.toThrow("lost connection");
    expect(events).toContainEqual(expect.objectContaining({ type: "utterance_end", interrupted: true }));
    expect(session.messages.map(message => message.role)).toEqual(["user"]);
  });
  it("limits narration to three utterances in a turn", async () => {
    const events: StreamEvent[] = [];
    const model = new StreamingScript([assistant(...Array.from({ length: 5 }, () => call("narrate_to_guest", { expression: "thinking", text: "（鲸鱼娘翻看菜单。）" }))), final()]);
    await runAgent(newSession("demo"), new MockOrderingProvider(), model, "看看", event => events.push(event));
    expect(events.filter(event => event.type === "utterance_start" && event.phase === "progress")).toHaveLength(3);
  });
});

describe("visible text playback", () => {
  it("keeps actions silent across chunks and only voices subsequently displayed speech", () => {
    const player = new DialoguePlayback(); player.start("a", "progress", "happy");
    player.append("a", "好呀（摇"); let spoken = "";
    while (player.buffered()) spoken += player.tick()?.glyphs || "";
    player.append("a", "尾巴）客人");
    while (player.buffered()) spoken += player.tick()?.glyphs || "";
    expect(spoken).toBe("好呀客人");
    expect(stageParts("好呀（摇尾巴）客人").filter(part => part.action).map(part => part.text)).toEqual(["（摇尾巴）"]);
    expect(spokenSlice(Array.from("（一（二）三）你好"), 0, 10)).toBe("你好");
  });
  it("deduplicates starts and ends, preserves segment order, and skip never replays old text", () => {
    const player = new DialoguePlayback(); player.start("a", "progress", "happy"); player.start("a", "progress", "happy");
    player.append("a", "客人"); player.skipReceived(); expect(player.tick()).toBeUndefined();
    player.append("a", "好呀"); expect(player.tick()?.glyphs).toBe("好呀");
    player.finish("a", { text: "客人好呀", expression: "happy", choices: [] });
    player.finish("a", { text: "重复", expression: "happy", choices: [] });
    expect(player.snapshot()).toHaveLength(1); expect(player.snapshot()[0].text).toBe("客人好呀");
  });
  it("clears unplayed text on interruption and discards old text when a new turn begins", () => {
    const player = new DialoguePlayback(); player.start("a", "final", "happy"); player.append("a", "你好客人尚未显示");
    player.tick(); player.interrupt(); expect(player.tick()).toBeUndefined();
    expect(player.snapshot()[0]).toMatchObject({ text: "你好", interrupted: true });
    player.reset(); expect(player.snapshot()).toEqual([]);
  });
});
