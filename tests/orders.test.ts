import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { newSession } from "@/lib/domain/types";
import { confirmOrder, isExplicitConfirmation, mcdArguments, quoteOrder, setCart, setContext } from "@/lib/domain/orders";
import { MockOrderingProvider } from "@/lib/providers/mock";
import { DEMO_COUPONS, DEMO_MEALS, demoDetail } from "@/lib/providers/fixtures";
import { LiveRepository, MemoryJournal } from "@/lib/server/repository";

export async function readyCart() {
  const session = newSession("demo"), provider = new MockOrderingProvider();
  session.stores["DEMO-001"] = { storeCode: "DEMO-001", storeName: "模拟店", beCode: "unused-for-pickup" };
  setContext(session, { fulfillment: "pickup", storeCode: "DEMO-001" });
  for (const [code, meal] of Object.entries(DEMO_MEALS)) { session.catalog[code] = { code, name: meal.name }; session.details[code] = demoDetail(code); }
  for (const coupon of DEMO_COUPONS) session.coupons[coupon.couponId] = { ...coupon, products: [{ productCode: coupon.productCode }] };
  setCart(session, { items: [{ productCode: "2001", quantity: 1, couponId: "DEMO-LUNCH", roundList: [{ round: "drink", comboItemList: [{ code: "4002", quantity: 1 }] }] }] });
  await quoteOrder(session, provider); setContext(session, { takeWayCode: "counter" }); await quoteOrder(session, provider);
  return { session, provider };
}
describe("verified order state", () => {
  it("fills default combo rounds and respects a verified substitution/coupon", async () => {
    const { session } = await readyCart();
    expect(session.draft.items[0].options).toEqual(["中份薯条", "中杯无糖可乐"]);
    expect(session.quote?.totalCents).toBe(2990);
    expect(session.quote?.discountCents).toBe(210);
    expect(mcdArguments(session)).not.toHaveProperty("beCode");
  });
  it("rejects invented products, coupon IDs, combo choices, and modification keys", async () => {
    const { session } = await readyCart();
    expect(() => setCart(session, { items: [{ productCode: "made-up", quantity: 1 }] })).toThrow();
    expect(() => setCart(session, { items: [{ productCode: "2001", quantity: 1, couponId: "free-money" }] })).toThrow();
    expect(() => setCart(session, { items: [{ productCode: "2001", quantity: 1, roundList: [{ round: "drink", comboItemList: [{ code: "coffee-not-offered", quantity: 1 }] }] }] })).toThrow();
    expect(() => setCart(session, { items: [{ productCode: "1001", quantity: 1, modification: { values: [{ code: "sauce", quantity: 0, key: "arbitrary" }] } }] })).toThrow();
  });
  it("validates default and overridden groups from the actual MCP rounds/choices shape", async () => {
    const { session } = await readyCart();
    session.details["2001"] = { code: "2001", rounds: [{ id: 1, minQuantity: 1, maxQuantity: 1, choices: [{ code: "3001", name: "中薯条", isDefault: 1, quantity: 1, maxQuantity: -1 }, { code: "3002", name: "玉米杯", isDefault: 0, quantity: 0, maxQuantity: -1 }] }] };
    setCart(session, { items: [{ productCode: "2001", quantity: 1, roundList: [{ round: "1", comboItemList: [{ code: "3002", quantity: 1 }] }] }] });
    expect(session.draft.items[0].options).toEqual(["玉米杯"]);
  });
  it("invalidates old quote when quantities/options change", async () => {
    const { session, provider } = await readyCart(), oldId = session.quote!.id;
    setCart(session, { items: [{ productCode: "1003", quantity: 2 }] });
    expect(session.quote).toBeNull();
    const spy = vi.spyOn(provider, "callTool");
    await expect(confirmOrder(session, provider, new MemoryJournal(), { message: "确认下单", quoteId: oldId, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "STALE_CONFIRMATION" });
    expect(spy.mock.calls.some(([name]) => name === "create-order")).toBe(false);
  });
  it("clears old cart when store or fulfillment changes", async () => {
    const { session } = await readyCart();
    setContext(session, { fulfillment: "delivery" });
    expect(session.draft.items).toEqual([]); expect(session.draft.store).toBeNull(); expect(session.quote).toBeNull();
  });
  it("requires the precise confirmation phrase and latest quote ID", async () => {
    expect(isExplicitConfirmation("好的")).toBe(false);
    expect(isExplicitConfirmation("确认下单，再加一个汉堡")).toBe(false);
    expect(isExplicitConfirmation("确认下单！")).toBe(true);
    const { session, provider } = await readyCart();
    await expect(confirmOrder(session, provider, new MemoryJournal(), { message: "好的", quoteId: session.quote!.id, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await expect(confirmOrder(session, provider, new MemoryJournal(), { message: "确认下单", quoteId: crypto.randomUUID(), requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "STALE_CONFIRMATION" });
  });
  it("re-quotes changed prices without creating an order", async () => {
    const { session } = await readyCart(), provider = new MockOrderingProvider({ priceDelta: 200 }), spy = vi.spyOn(provider, "callTool");
    const result = await confirmOrder(session, provider, new MemoryJournal(), { message: "确认下单", quoteId: session.quote!.id, requestId: crypto.randomUUID() });
    expect(result.kind).toBe("price_changed"); expect(session.quote?.totalCents).toBe(3190);
    expect(spy.mock.calls.filter(([name]) => name === "create-order")).toHaveLength(0);
  });
  it("rejects an upstream response with no price instead of displaying a free order", async () => {
    const { session, provider } = await readyCart();
    vi.spyOn(provider, "callTool").mockResolvedValueOnce({ success: true, data: {} });
    await expect(quoteOrder(session, provider)).rejects.toMatchObject({ code: "PRICE_UNAVAILABLE" });
  });
  it("creates once for concurrent confirmations and repeated requests", async () => {
    const { session, provider } = await readyCart(), secondSession = structuredClone(session), journal = new MemoryJournal(), spy = vi.spyOn(provider, "callTool");
    const quoteId = session.quote!.id;
    await Promise.all([session, secondSession].map(s => confirmOrder(s, provider, journal, { message: "确认下单", quoteId, requestId: crypto.randomUUID() })));
    await confirmOrder(session, provider, journal, { message: "确认下单", quoteId, requestId: crypto.randomUUID() });
    expect(spy.mock.calls.filter(([name]) => name === "create-order")).toHaveLength(1);
    expect((await journal.findAttempt(quoteId))?.status).toBe("created");
    expect(session.attempt?.paymentUrl).toBeUndefined();
  });
  it("marks a missing create response unknown and never retries that submission", async () => {
    const { session } = await readyCart(), provider = new MockOrderingProvider({ failCreate: true }), journal = new MemoryJournal(), spy = vi.spyOn(provider, "callTool"), quoteId = session.quote!.id;
    await confirmOrder(session, provider, journal, { message: "确认下单", quoteId, requestId: crypto.randomUUID() });
    expect(session.attempt?.status).toBe("unknown");
    await confirmOrder(session, provider, journal, { message: "确认下单", quoteId, requestId: crypto.randomUUID() });
    expect(spy.mock.calls.filter(([name]) => name === "create-order")).toHaveLength(1);
    expect(() => setCart(session, { items: [] })).toThrow();
  });
  it("requires delivery address plus its business code", async () => {
    const { session } = await readyCart(); session.draft.fulfillment = "delivery";
    expect(() => mcdArguments(session)).toThrow();
    session.draft.address = { addressId: "mock-address", fullAddress: "模拟地址" };
    session.draft.store!.beCode = "delivery-code";
    expect(mcdArguments(session)).toMatchObject({ beCode: "delivery-code", beType: 2, orderType: 2 });
  });
  it("preserves long string order IDs and ignores an untrusted payment URL", async () => {
    const { session, provider: mock } = await readyCart(); session.mode = "live";
    const orderId = "1030938730000733964700499858";
    const provider = { mode: "live" as const, listTools: async () => [], close: async () => {}, callTool: async (name: string, args: Record<string, unknown>) => name === "create-order" ? { success: true, data: { orderId, payH5Url: "https://mcd.cn.evil.example/pay", orderDetail: { orderStatus: "待支付" } } } : mock.callTool(name, args) };
    await confirmOrder(session, provider, new MemoryJournal(), { message: "确认下单", quoteId: session.quote!.id, requestId: crypto.randomUUID() });
    expect(session.attempt?.orderId).toBe(orderId); expect(session.attempt?.paymentUrl).toBeUndefined(); expect(session.attempt?.status).toBe("created");
  });
  it("rejects a live provider accidentally attached to a demo session before any call", async () => {
    const { session } = await readyCart();
    const call = vi.fn();
    const provider = { mode: "live" as const, callTool: call, listTools: async () => [], close: async () => {} };
    await expect(quoteOrder(session, provider)).rejects.toMatchObject({ code: "MODE_MISMATCH" });
    await expect(confirmOrder(session, provider, new MemoryJournal(), { message: "确认下单", quoteId: session.quote!.id, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "MODE_MISMATCH" });
    expect(call).not.toHaveBeenCalled();
  });
});
describe("durable personal journal", () => {
  it("retains submission keys across restart, isolates accounts, and locks concurrent turns", async () => {
    const directory = resolve("tmp", `repository-test-${crypto.randomUUID()}`), { session } = await readyCart();
    const attempt = { id: crypto.randomUUID(), quoteId: session.quote!.id, requestId: crypto.randomUUID(), status: "submitting" as const, createdAt: new Date().toISOString() };
    let repo = await LiveRepository.open(directory, "test-account-a");
    await repo.saveSession(session); repo.acquire(session.id); expect(() => repo.acquire(session.id)).toThrow(); repo.release(session.id);
    expect(await repo.reserveAttempt(attempt)).toBe(true); repo.close();
    repo = await LiveRepository.open(directory, "test-account-a");
    expect((await repo.findAttempt(attempt.quoteId))?.id).toBe(attempt.id); expect(await repo.reserveAttempt(attempt)).toBe(false); expect(repo.getSession(session.id)?.draft.items).toHaveLength(1); repo.close();
    const other = await LiveRepository.open(directory, "test-account-b"); expect(await other.findAttempt(attempt.quoteId)).toBeNull(); expect(other.getSession(session.id)).toBeNull(); other.close();
  });
});
