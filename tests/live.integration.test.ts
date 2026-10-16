import { describe, expect, it, vi } from "vitest";
import { runAgent } from "@/lib/agent/engine";
import { DeepSeekModel } from "@/lib/agent/model";
import { confirmOrder } from "@/lib/domain/orders";
import { dataOf, object } from "@/lib/domain/normalize";
import { newSession } from "@/lib/domain/types";
import { McdOrderingProvider } from "@/lib/providers/mcp";
import { MockOrderingProvider } from "@/lib/providers/mock";
import { MemoryJournal } from "@/lib/server/repository";

describe.skipIf(process.env.MGO_LIVE_TESTS !== "1")("explicit live integration (read-only MCP, simulated order creation)", () => {
  it("discovers schemas and reads live stores, menu, detail and integer-cent prices", async () => {
    const provider = new McdOrderingProvider(process.env.MCD_MCP_TOKEN!);
    try {
      const tools = await provider.listTools(); expect(tools.some(t => t.function.name === "query_meals")).toBe(true);
      const stores = dataOf(await provider.callTool("query-nearby-stores", { city: "上海市", keyword: "人民广场", beType: 1, searchType: 2 })) as { storeCode: string }[];
      expect(stores.length).toBeGreaterThan(0);
      const args = { storeCode: String(stores[0].storeCode), beType: 1, orderType: 1 };
      const menu = object(dataOf(await provider.callTool("query-meals", args))), meals = object(menu.meals), code = Object.keys(meals)[0];
      expect(code).toBeTruthy();
      const detail = object(dataOf(await provider.callTool("query-meal-detail", { ...args, code })));
      expect(detail.name).toBeTruthy();
      const price = object(dataOf(await provider.callTool("calculate-price", { ...args, needTableware: false, items: [{ productCode: code, quantity: 1 }] })));
      expect(Number.isSafeInteger(price.price)).toBe(true); expect(Number(price.price)).toBeGreaterThan(0);
      console.info(JSON.stringify({ proof: "live-mcp-readonly", tools: tools.length, stores: stores.length, meals: Object.keys(meals).length, priceCents: price.price, createOrderCalled: false }));
    } finally { await provider.close(); }
  }, 60000);
  it("uses real DeepSeek to plan a mock order, retain substitutions, quote and confirm it", async () => {
    const session = newSession("demo"), provider = new MockOrderingProvider(), spy = vi.spyOn(provider, "callTool");
    const model = new DeepSeekModel(process.env.DEEPSEEK_API_KEY!, process.env.DEEPSEEK_MODEL || "deepseek-flash");
    await runAgent(session, provider, model, "我在上海人民广场，到店自取，选搜索结果第一家餐厅。来一份麦辣鸡腿堡套餐，饮料换成无糖可乐，预算30元。请先整理点单，再让我选取餐方式。", () => {}, AbortSignal.timeout(120000));
    expect(session.draft.items).toHaveLength(1); expect(session.draft.items[0].productCode).toBe("2002");
    expect(session.draft.items[0].options.join(" ")).toContain("无糖"); expect(session.quote?.totalCents).toBeLessThanOrEqual(3000);
    await runAgent(session, provider, model, "把套餐内的薯条换成玉米杯，饮料保持无糖，其他不变。", () => {}, AbortSignal.timeout(120000));
    expect(session.draft.items).toHaveLength(1); expect(session.draft.items[0].options.join(" ")).toContain("玉米"); expect(session.draft.items[0].options.join(" ")).toContain("无糖");
    await runAgent(session, provider, model, "打包带走，请重新核价，然后给我看点单夹。", () => {}, AbortSignal.timeout(120000));
    expect(session.draft.takeWayCode).toBe("takeaway"); expect(session.quote).not.toBeNull(); expect(session.attempt).toBeNull();
    expect(spy.mock.calls.filter(([name]) => name === "create-order")).toHaveLength(0);
    await confirmOrder(session, provider, new MemoryJournal(), { message: "确认下单", quoteId: session.quote!.id, requestId: crypto.randomUUID() });
    expect(session.attempt?.status).toBe("created"); expect(session.attempt?.orderId).toMatch(/^DEMO-/); expect(session.attempt?.paymentUrl).toBeUndefined();
    console.info(JSON.stringify({ proof: "real-model-mock-order", model: process.env.DEEPSEEK_MODEL || "deepseek-flash", tools: spy.mock.calls.map(([name]) => name), totalCents: session.quote!.totalCents, orderMode: provider.mode }));
  }, 240000);
});
