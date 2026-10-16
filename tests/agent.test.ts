import { describe, expect, it, vi } from "vitest";
import { runAgent, prepareReadArguments } from "@/lib/agent/engine";
import type { ModelClient } from "@/lib/agent/model";
import { newSession, type ModelMessage } from "@/lib/domain/types";
import { MockOrderingProvider } from "@/lib/providers/mock";
import { MgoError } from "@/lib/domain/errors";
function response(name: string, args: unknown): ModelMessage { return { role: "assistant", content: null, tool_calls: [{ id: crypto.randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } }] }; }
const finish = response("reply_to_guest", { text: "点单夹准备好啦，客人想在柜台取餐，还是打包带走？", expression: "happy", choices: ["柜台取餐", "打包带走"] });
class ScriptedModel implements ModelClient {
  calls = 0;
  constructor(private replies: ModelMessage[]) {}
  async complete() { return this.replies[this.calls++] || finish; }
}
describe("one agent, verified tools", () => {
  it("searches, selects, loads details, edits, quotes, and renders a structured reply", async () => {
    const session = newSession("demo"), provider = new MockOrderingProvider();
    const model = new ScriptedModel([
      response("query_nearby_stores", { city: "上海市", keyword: "人民广场" }),
      response("set_order_context", { fulfillment: "pickup", storeCode: "DEMO-001" }),
      response("query_meals", {}), response("query_meal_detail", { code: "2002" }),
      response("set_cart", { items: [{ productCode: "2002", quantity: 1 }] }), response("quote_order", {}), finish,
    ]);
    const events: unknown[] = [];
    await runAgent(session, provider, model, "在上海人民广场第一家店自取，来份麦辣套餐", e => events.push(e));
    expect(model.calls).toBe(7); expect(session.draft.items[0].name).toBe("麦辣鸡腿堡套餐"); expect(session.quote?.totalCents).toBe(2990); expect(session.attempt).toBeNull();
    expect(events).toContainEqual(expect.objectContaining({ type: "reply", reply: expect.objectContaining({ expression: "happy" }) }));
  });
  it("does not expose create-order to the model, even if the model invents a tool call", async () => {
    const session = newSession("demo"), provider = new MockOrderingProvider(), spy = vi.spyOn(provider, "callTool");
    await runAgent(session, provider, new ScriptedModel([response("create_order", { items: [] }), finish]), "帮我点餐", () => {});
    expect(spy).not.toHaveBeenCalledWith("create-order", expect.anything(), expect.anything()); expect(session.attempt).toBeNull();
    expect(session.messages.some(m => m.role === "tool" && m.content?.includes("TOOL_NOT_ALLOWED"))).toBe(true);
  });
  it("keeps tool-call history complete when its execution limit is reached", async () => {
    const session = newSession("demo"), model = { complete: vi.fn(async () => ({ role: "assistant" as const, content: null, tool_calls: Array.from({ length: 4 }, () => response("search_menu", {}).tool_calls![0]) })) };
    await runAgent(session, new MockOrderingProvider(), model, "看看菜单", () => {});
    expect(model.complete.mock.calls.length).toBeLessThanOrEqual(8);
    const calls = session.messages.flatMap(m => m.tool_calls?.map(c => c.id) || []), results = session.messages.filter(m => m.role === "tool").map(m => m.tool_call_id);
    expect(results).toEqual(calls);
  });
  it("prevents fabricated address registration data", () => {
    const session = newSession("demo"); session.messages = [{ role: "user", content: "我想新增地址，城市是上海" }];
    expect(() => prepareReadArguments(session, "delivery-create-address", { city: "上海市", phone: "13812345678", contactName: "虚构姓名", address: "虚构地址", addressDetail: "101" })).toThrow();
  });
  it("replaces premature confirmation choices with verified pickup choices", async () => {
    const session = newSession("demo");
    session.draft.fulfillment = "pickup"; session.draft.store = { storeCode: "DEMO-001", storeName: "模拟店" };
    session.quote = { id: crypto.randomUUID(), revision: 0, fingerprint: "0".repeat(64), productCents: 2550, deliveryCents: 0, tablewareCents: 0, discountCents: 0, totalCents: 2550, lines: [], takeWays: [{ code: "counter", name: "柜台取餐" }, { code: "takeaway", name: "打包带走" }], createdAt: new Date().toISOString() };
    const reply = await runAgent(session, new MockOrderingProvider(), new ScriptedModel([response("reply_to_guest", { text: "确认下单就好。", expression: "happy", choices: ["确认下单"] })]), "看看点单", () => {});
    expect(reply.choices).toEqual(["柜台取餐", "打包带走"]); expect(reply.text).toContain("¥25.50");
  });
  it("does not blindly repeat an address write after a missing response", async () => {
    const session = newSession("demo"), provider = new MockOrderingProvider();
    const spy = vi.spyOn(provider, "callTool").mockRejectedValue(new MgoError("TIMEOUT", "response missing", 504));
    const args = { city: "上海市", contactName: "测试客人", phone: "13800000000", address: "演示花园1号楼", addressDetail: "101室" };
    await runAgent(session, provider, new ScriptedModel([response("delivery_create_address", args), response("delivery_create_address", args), finish]), "新增地址：上海市，测试客人，13800000000，演示花园1号楼，101室", () => {});
    expect(spy).toHaveBeenCalledTimes(1); expect(session.addressWritePending).toBe(true);
  });
});
