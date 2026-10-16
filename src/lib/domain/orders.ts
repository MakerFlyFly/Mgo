import { createHash } from "node:crypto";
import { z } from "zod";
import { MgoError } from "./errors";
import { dataOf, integerCents, key, nameOf, object, walk } from "./normalize";
import type { CartItem, JsonObject, OrderAttempt, Quote, Session } from "./types";
import type { OrderingProvider } from "../providers/types";

const identifier = z.string().min(1).max(150).refine(v => !!key(v), "无效编号");
export const contextSchema = z.object({
  fulfillment: z.enum(["pickup", "delivery"]).optional(), storeCode: identifier.optional(),
  addressId: identifier.optional(), takeWayCode: identifier.optional(),
  needTableware: z.boolean().optional(), remark: z.string().max(50).optional(),
}).strict();
const modificationSchema = z.object({ values: z.array(z.object({ code: identifier, quantity: z.number().int().min(0).max(20), key: z.string().min(1).max(100) }).strict()).max(20) }).strict();
const groupSchema = z.object({ round: identifier, comboItemList: z.array(z.object({ code: identifier, quantity: z.number().int().min(1).max(20), modification: modificationSchema.optional() }).strict()).min(1).max(20) }).strict();
export const cartSchema = z.object({ items: z.array(z.object({
  lineId: identifier.optional(), productCode: identifier, quantity: z.number().int().min(1).max(20),
  couponId: identifier.optional(), couponCode: identifier.optional(),
  roundList: z.array(groupSchema).max(20).optional(), modification: modificationSchema.optional(),
}).strict()).max(30) }).strict();
export interface OrderJournal {
  findAttempt(quoteId: string): Promise<OrderAttempt | null>;
  reserveAttempt(attempt: OrderAttempt): Promise<boolean>;
  saveAttempt(attempt: OrderAttempt): Promise<void>;
  saveSession(session: Session): Promise<void>;
}
export function editable(session: Session) {
  if (session.attempt) throw new MgoError("ORDER_ALREADY_SUBMITTED", session.attempt.status === "unknown" || session.attempt.status === "submitting" ? "这笔订单正在核实提交结果，请先查询订单，避免重复下单。" : "这份点单已经提交，请先查看订单；新点单请使用「再来一单」。");
}
function invalidate(session: Session) { session.draft.revision++; session.quote = null; session.updatedAt = new Date().toISOString(); }
export function setContext(session: Session, input: unknown) {
  editable(session);
  const next = contextSchema.parse(input), draft = session.draft;
  const previous = JSON.stringify(draft);
  const changedMode = next.fulfillment !== undefined && next.fulfillment !== draft.fulfillment;
  const changedStore = next.storeCode !== undefined && next.storeCode !== draft.store?.storeCode;
  const changedAddress = next.addressId !== undefined && next.addressId !== draft.address?.addressId;
  if (next.storeCode && !Object.hasOwn(session.stores, next.storeCode)) throw new MgoError("UNKNOWN_STORE", "请先查询并让客人选择门店。");
  if (next.addressId && !Object.hasOwn(session.addresses, next.addressId)) throw new MgoError("UNKNOWN_ADDRESS", "请先查询或新增地址，再选择地址。");
  if (next.takeWayCode && !session.quote?.takeWays.some(t => t.code === next.takeWayCode) && next.takeWayCode !== draft.takeWayCode) throw new MgoError("UNKNOWN_TAKE_WAY", "取餐方式必须来自最新计价结果。");
  if (changedMode || changedStore || changedAddress) {
    draft.items = []; draft.store = null; draft.takeWayCode = undefined;
    session.catalog = {}; session.details = {}; session.coupons = {};
    if (changedMode) draft.address = null;
  }
  if (next.fulfillment) draft.fulfillment = next.fulfillment;
  if (next.storeCode) draft.store = session.stores[next.storeCode];
  if (next.addressId) { draft.address = session.addresses[next.addressId]; session.addressWritePending = false; }
  if (next.takeWayCode) draft.takeWayCode = next.takeWayCode;
  if (next.needTableware !== undefined) draft.needTableware = next.needTableware;
  if (next.remark !== undefined) draft.remark = next.remark;
  if (JSON.stringify(draft) !== previous) invalidate(session);
  return { draft, notice: changedMode || changedStore || changedAddress ? "就餐上下文变化，原餐品已清空，请按新门店菜单重新选餐。" : "点单信息已更新。" };
}
function validateModification(input: JsonObject | undefined, detail: JsonObject, labels: string[]) {
  if (!input) return undefined;
  const parsed = modificationSchema.parse(input);
  const offered: JsonObject[] = [];
  walk(detail.modification, entry => { if (entry.code && (entry.selectedKey || entry.unselectedKey)) offered.push(entry); });
  const seen = new Set<string>();
  for (const value of parsed.values) {
    if (seen.has(value.code)) throw new MgoError("INVALID_MODIFICATION", "同一特制选项不能重复设置。");
    seen.add(value.code);
    const match = offered.find(entry => String(entry.code) === value.code && [entry.selectedKey, entry.unselectedKey].includes(value.key));
    if (!match || value.quantity < Number(match.minQuantity ?? 0) || value.quantity > Number(match.maxQuantity ?? 20)) throw new MgoError("INVALID_MODIFICATION", "特制内容必须来自这份餐品的可选项。");
    labels.push(`${nameOf(match)}${value.quantity === 0 ? "：不加" : ""}`);
  }
  return parsed;
}
function comboGroups(detail: JsonObject) {
  const groups = (Array.isArray(detail.rounds) ? detail.rounds : Array.isArray(detail.roundList) ? detail.roundList : []) as JsonObject[];
  return groups.map(group => ({
    id: String(group.id ?? group.round), min: Number(group.minQuantity ?? group.quantity ?? 1), max: Number(group.maxQuantity ?? group.quantity ?? 1),
    choices: (Array.isArray(group.choices) ? group.choices : group.comboItemList || []) as JsonObject[],
  }));
}
export function setCart(session: Session, input: unknown) {
  editable(session);
  if (!session.draft.store || !session.draft.fulfillment) throw new MgoError("MISSING_CONTEXT", "请先确定就餐方式和门店。");
  const parsed = cartSchema.parse(input), ids = new Set<string>();
  if (parsed.items.reduce((sum, item) => sum + item.quantity, 0) > 50) throw new MgoError("TOO_MANY_ITEMS", "每份点单最多50件餐品。");
  const items: CartItem[] = parsed.items.map((item, index) => {
    if (!Object.hasOwn(session.catalog, item.productCode) || !Object.hasOwn(session.details, item.productCode)) throw new MgoError("UNVERIFIED_MEAL", "加进点单前必须查询当前门店菜单和这份餐品的详情。");
    const lineId = item.lineId || `line-${index + 1}`;
    if (ids.has(lineId)) throw new MgoError("DUPLICATE_LINE", "每行点单需使用不同的行编号。");
    ids.add(lineId);
    const detail = session.details[item.productCode], options: string[] = [];
    const groups = comboGroups(detail), overrides = new Map((item.roundList || []).map(group => [group.round, group]));
    if (overrides.size !== (item.roundList?.length || 0) || [...overrides.keys()].some(id => !groups.some(group => group.id === id))) throw new MgoError("INVALID_COMBO", "套餐轮次必须来自餐品详情，且不能重复。");
    const roundList = groups.map(group => {
      const selected = overrides.get(group.id)?.comboItemList || group.choices.filter(c => c.default === true || c.isDefault === 1 || (c.isDefault === undefined && Number(c.quantity) > 0)).map(c => ({ code: String(c.code), quantity: Number(c.quantity) > 0 ? Number(c.quantity) : 1 }));
      const total = selected.reduce((sum, choice) => sum + choice.quantity, 0);
      if (total < group.min || (group.max >= 0 && total > group.max)) throw new MgoError("INVALID_COMBO", "套餐子项数量不符合餐品规则。");
      return { round: group.id, comboItemList: selected.map(choice => {
        const offered = group.choices.find(c => String(c.code) === choice.code);
        if (!offered) throw new MgoError("INVALID_COMBO", "这份套餐不支持该替换选项。");
        const max = Number(offered.maxQuantity ?? -1);
        if (max >= 0 && choice.quantity > max) throw new MgoError("INVALID_COMBO", "套餐子项超过可选数量。");
        options.push(nameOf(offered));
        const modification = validateModification("modification" in choice ? choice.modification as JsonObject : undefined, offered, options);
        return { code: choice.code, quantity: choice.quantity, ...(modification ? { modification } : {}) };
      }) };
    });
    const modification = validateModification(item.modification, detail, options);
    let couponCode: string | undefined;
    if (item.couponId) {
      const coupon = Object.hasOwn(session.coupons, item.couponId) ? session.coupons[item.couponId] : null;
      const products = coupon && Array.isArray(coupon.products) ? coupon.products as JsonObject[] : [];
      if (!coupon || !products.some(product => String(product.productCode ?? product.code) === item.productCode)) throw new MgoError("COUPON_UNVERIFIED", "请先查询当前门店可用优惠券，并选择适用餐品。");
      couponCode = String(coupon.couponCode || "");
      if (!couponCode || (item.couponCode && item.couponCode !== couponCode)) throw new MgoError("COUPON_UNVERIFIED", "优惠券编码与接口结果不一致。");
    } else if (item.couponCode) throw new MgoError("COUPON_UNVERIFIED", "优惠券编号与编码需要配对使用。");
    return { lineId, productCode: item.productCode, name: nameOf(session.catalog[item.productCode]), quantity: item.quantity, options, ...(roundList.length ? { roundList } : {}), ...(modification ? { modification } : {}), ...(item.couponId ? { couponId: item.couponId, couponCode } : {}) };
  });
  if (JSON.stringify(items) !== JSON.stringify(session.draft.items)) { session.draft.items = items; invalidate(session); }
  return { draft: session.draft, notice: "点单已更新；需要调用 quote_order 核价后才能向客人报总价。" };
}
export function mcdArguments(session: Session): JsonObject {
  const d = session.draft;
  if (!d.store || !d.fulfillment) throw new MgoError("MISSING_CONTEXT", "请先选好就餐方式和门店。");
  const delivery = d.fulfillment === "delivery";
  if (delivery && (!d.address || !d.store.beCode)) throw new MgoError("MISSING_ADDRESS", "外送需要选择可配送地址和对应的配送门店。");
  return {
    storeCode: d.store.storeCode, orderType: delivery ? 2 : 1, beType: delivery ? 2 : 1,
    ...(delivery ? { beCode: d.store.beCode } : {}), needTableware: d.needTableware,
    items: d.items.map(({ productCode, quantity, couponId, couponCode, roundList, modification }) => ({ productCode, quantity, ...(couponId ? { couponId, couponCode } : {}), ...(roundList ? { roundList } : {}), ...(modification ? { modification } : {}) })),
  };
}
export function draftFingerprint(session: Session) {
  return createHash("sha256").update(JSON.stringify({ ...mcdArguments(session), addressId: session.draft.address?.addressId, takeWayCode: session.draft.takeWayCode, remark: session.draft.remark })).digest("hex");
}
export async function quoteOrder(session: Session, provider: OrderingProvider, signal?: AbortSignal): Promise<Quote> {
  if (session.mode !== provider.mode) throw new MgoError("MODE_MISMATCH", "体验模式与点餐服务不匹配，已停止操作。", 500);
  if (!session.draft.items.length) throw new MgoError("EMPTY_CART", "点单夹还是空的，先选一些餐品吧。");
  const raw = object(dataOf(await provider.callTool("calculate-price", mcdArguments(session), signal)));
  if (raw.price === undefined || raw.price === null) throw new MgoError("PRICE_UNAVAILABLE", "计价接口没有返回有效总价，请稍后重新核价。", 502);
  const takeWays = (Array.isArray(raw.takeWayList) ? raw.takeWayList : []).map(t => { const entry = object(t); return { code: String(entry.code || ""), name: String(entry.title ?? entry.name ?? entry.code) }; }).filter(t => t.code);
  if (session.draft.fulfillment === "pickup" && session.draft.takeWayCode && !takeWays.some(t => t.code === session.draft.takeWayCode)) { session.draft.takeWayCode = undefined; invalidate(session); }
  if (session.draft.fulfillment === "pickup" && !session.draft.takeWayCode && takeWays.length === 1) { session.draft.takeWayCode = takeWays[0].code; session.draft.revision++; }
  const totalCents = integerCents(raw.price), discountCents = integerCents(raw.discount);
  const deliveryCents = integerCents(raw.deliveryOriginalPrice ?? raw.deliveryPrice), tablewareCents = integerCents(raw.tablewarePrice);
  const quote: Quote = {
    id: crypto.randomUUID(), revision: session.draft.revision, fingerprint: draftFingerprint(session),
    productCents: integerCents(raw.productOriginalPrice ?? totalCents + discountCents - deliveryCents - tablewareCents),
    deliveryCents, tablewareCents, discountCents, totalCents, takeWays, createdAt: new Date().toISOString(),
    lines: (Array.isArray(raw.productList) ? raw.productList : []).map(item => { const entry = object(item); return { name: String(entry.productName || "餐品"), quantity: Number(entry.quantity || 1), subtotalCents: integerCents(entry.originalSubtotal ?? entry.subtotal) }; }),
  };
  session.quote = quote;
  return quote;
}
export const isExplicitConfirmation = (text: string) => /^\s*确认下单[。！!～~\s]*$/.test(text);
export async function confirmOrder(session: Session, provider: OrderingProvider, journal: OrderJournal, input: { message: string; quoteId?: string; requestId: string }, signal?: AbortSignal) {
  if (session.mode !== provider.mode) throw new MgoError("MODE_MISMATCH", "体验模式与点餐服务不匹配，已停止操作。", 500);
  if (!isExplicitConfirmation(input.message)) throw new MgoError("CONFIRMATION_REQUIRED", "请在看过点单夹后，明确输入「确认下单」。");
  const quoted = session.quote;
  const prior = input.quoteId ? await journal.findAttempt(input.quoteId) : null;
  if (prior) { session.attempt = prior; return { kind: "existing" as const, attempt: prior }; }
  if (session.attempt) return { kind: "existing" as const, attempt: session.attempt };
  if (!quoted || quoted.id !== input.quoteId || quoted.revision !== session.draft.revision || quoted.fingerprint !== draftFingerprint(session)) throw new MgoError("STALE_CONFIRMATION", "点单内容已经更新，请先重新核价并查看最新点单夹。");
  if (session.draft.fulfillment === "pickup" && !session.draft.takeWayCode) throw new MgoError("MISSING_TAKE_WAY", "还需要选择取餐方式，请从点单夹列出的选项中选择。");
  const fresh = await quoteOrder(session, provider, signal);
  const moneyFields = ["productCents", "deliveryCents", "tablewareCents", "discountCents", "totalCents"] as const;
  if (fresh.fingerprint !== quoted.fingerprint || moneyFields.some(field => fresh[field] !== quoted[field])) return { kind: "price_changed" as const, quote: fresh };
  // Preserve the user's accepted quote ID: the unique journal key deduplicates every retry.
  session.quote = { ...fresh, id: quoted.id };
  const attempt: OrderAttempt = { id: crypto.randomUUID(), quoteId: quoted.id, requestId: input.requestId, status: "submitting", createdAt: new Date().toISOString() };
  if (!await journal.reserveAttempt(attempt)) { const existing = await journal.findAttempt(quoted.id); if (!existing) throw new MgoError("ORDER_BUSY", "订单正在提交，请稍后查看。"); session.attempt = existing; return { kind: "existing" as const, attempt: existing }; }
  session.attempt = attempt; await journal.saveSession(session);
  try {
    const delivery = session.draft.fulfillment === "delivery";
    const raw = object(dataOf(await provider.callTool("create-order", { ...mcdArguments(session), ...(delivery ? { addressId: session.draft.address!.addressId, ...(session.draft.remark ? { remark: session.draft.remark } : {}) } : { takeWayCode: session.draft.takeWayCode }) }, signal)));
    if (!raw.orderId || (typeof raw.orderId !== "string" && !(typeof raw.orderId === "number" && Number.isSafeInteger(raw.orderId)))) throw new MgoError("UNVERIFIED_RESULT", "订单提交结果待核实。", 502);
    const detail = object(raw.orderDetail);
    attempt.status = "created"; attempt.orderId = String(raw.orderId); attempt.orderStatus = String(detail.orderStatus ?? raw.orderStatus ?? "待支付");
    attempt.pickupCode = detail.pickupCode ? String(detail.pickupCode) : undefined;
    if (provider.mode === "live" && typeof raw.payH5Url === "string") {
      try {
        const url = new URL(raw.payH5Url);
        if (url.protocol === "https:" && (url.hostname === "mcd.cn" || url.hostname.endsWith(".mcd.cn") || url.hostname === "mcdchina.net" || url.hostname.endsWith(".mcdchina.net"))) attempt.paymentUrl = url.href;
      } catch { /* a bad optional URL does not undo an order with a verified ID */ }
    }
    attempt.message = provider.mode === "demo" ? "这是模拟订单，不会扣款或配送。" : "订单已创建，请通过麦当劳官方支付页面完成付款。";
  } catch {
    // A missing response cannot prove that an external create did not happen.
    attempt.status = "unknown"; attempt.message = "订单提交结果待核实，请查询近期订单或前往麦当劳官方渠道查看。请勿重复下单。";
  }
  await journal.saveAttempt(attempt); await journal.saveSession(session);
  return { kind: "submitted" as const, attempt };
}
