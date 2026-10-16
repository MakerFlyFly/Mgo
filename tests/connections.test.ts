import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourcePool } from "@/lib/providers/resource-pool";
import { McdOrderingProvider } from "@/lib/providers/mcp";
import { runAgent } from "@/lib/agent/engine";
import { newSession } from "@/lib/domain/types";

const sdk = vi.hoisted(() => ({ connects: vi.fn(), closes: vi.fn(), calls: vi.fn() }));
vi.mock("@modelcontextprotocol/client", () => ({
  StreamableHTTPClientTransport: class {},
  Client: class {
    connect = sdk.connects;
    close = sdk.closes;
    callTool = sdk.calls;
    async listTools() { return { tools: ["query-meals", "query-meal-detail", "calculate-price", "create-order", "query-nearby-stores", "delivery-create-address"].map(name => ({ name, inputSchema: { type: "object" } })) }; }
  },
}));
afterEach(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(61000); vi.useRealTimers(); vi.clearAllMocks(); });
function setup() {
  vi.useFakeTimers(); sdk.connects.mockResolvedValue(undefined); sdk.closes.mockResolvedValue(undefined);
  sdk.calls.mockReset().mockResolvedValue({ structuredContent: { success: true, data: [] } });
}

describe("MCP connection lifetime", () => {
  it("lists tools and completes small talk without contacting MCP, even without a token", async () => {
    setup(); const provider = new McdOrderingProvider("");
    const tools = await provider.listTools(); expect(tools.some(tool => tool.function.name === "query_meals")).toBe(true);
    await runAgent(newSession("live"), provider, { complete: async () => ({ role: "assistant", content: null, tool_calls: [{ id: "reply", type: "function", function: { name: "reply_to_guest", arguments: JSON.stringify({ expression: "happy", text: "欢迎客人，今天心情不错。", choices: [] }) } }] }) }, "聊聊", () => {});
    await provider.close(); expect(sdk.connects).not.toHaveBeenCalled(); expect(sdk.calls).not.toHaveBeenCalled();
  });
  it("reuses initialization across concurrent requests and only closes after all references and 60s idle", async () => {
    setup(); const token = crypto.randomUUID(), first = new McdOrderingProvider(token), second = new McdOrderingProvider(token);
    await Promise.all([first.callTool("query-meals", {}), second.callTool("query-meals", {})]);
    expect(sdk.connects).toHaveBeenCalledTimes(1);
    await first.close(); await vi.advanceTimersByTimeAsync(61000); expect(sdk.closes).not.toHaveBeenCalled();
    await second.close(); await vi.advanceTimersByTimeAsync(59000); expect(sdk.closes).not.toHaveBeenCalled();
    const third = new McdOrderingProvider(token); await third.callTool("query-meals", {}); expect(sdk.connects).toHaveBeenCalledTimes(1);
    await third.close(); await vi.advanceTimersByTimeAsync(60000); expect(sdk.closes).toHaveBeenCalledTimes(1);
  });
  it("isolates account credentials and retries a failed read once on a fresh connection", async () => {
    setup(); const a = new McdOrderingProvider(crypto.randomUUID()), b = new McdOrderingProvider(crypto.randomUUID());
    await Promise.all([a.callTool("query-meals", {}), b.callTool("query-meals", {})]); expect(sdk.connects).toHaveBeenCalledTimes(2);
    sdk.calls.mockRejectedValueOnce(new Error("network disconnected"));
    const reading = a.callTool("query-meals", {}); const observed = reading.then(value => value);
    await vi.advanceTimersByTimeAsync(400); await observed;
    expect(sdk.connects).toHaveBeenCalledTimes(3); expect(sdk.calls).toHaveBeenCalledTimes(4);
    await a.close(); await b.close();
  });
  it("does not retry a timed-out write or make any call for an unknown tool", async () => {
    setup(); const provider = new McdOrderingProvider(crypto.randomUUID()); sdk.calls.mockRejectedValueOnce(new Error("timeout"));
    await expect(provider.callTool("delivery-create-address", {})).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(sdk.calls).toHaveBeenCalledTimes(1);
    await expect(provider.callTool("invented-tool", {})).rejects.toMatchObject({ code: "TOOL_NOT_ALLOWED" });
    expect(sdk.calls).toHaveBeenCalledTimes(1); await provider.close();
  });
  it("honors the turn deadline during shared initialization and eventually releases the late connection", async () => {
    setup(); let finish!: () => void;
    sdk.connects.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const provider = new McdOrderingProvider(crypto.randomUUID()), abort = new AbortController();
    const request = provider.callTool("query-meals", {}, abort.signal);
    const observed = expect(request).rejects.toMatchObject({ code: "TIMEOUT" });
    await Promise.resolve(); await Promise.resolve(); abort.abort(); await observed;
    finish(); await vi.advanceTimersByTimeAsync(61000); expect(sdk.calls).not.toHaveBeenCalled(); expect(sdk.closes).toHaveBeenCalledOnce();
  });
  it("deduplicates pending factories and does not close an invalid resource still in use", async () => {
    vi.useFakeTimers(); const pool = new ResourcePool<{ close(): Promise<void> }>(60000), close = vi.fn(async () => {});
    let resolve!: (value: { close(): Promise<void> }) => void;
    const create = vi.fn(() => new Promise<{ close(): Promise<void> }>(done => { resolve = done; }));
    const one = pool.acquire("account", create), two = pool.acquire("account", create);
    await Promise.resolve(); expect(create).toHaveBeenCalledOnce(); resolve({ close });
    const [a, b] = await Promise.all([one, two]); a.invalidate(); a.release(); expect(close).not.toHaveBeenCalled();
    b.release(); await Promise.resolve(); expect(close).toHaveBeenCalledOnce();
  });
});
