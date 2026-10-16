import { z } from "zod";
import { MgoError, publicError } from "../domain/errors";
import { clipJson, dataOf, key, nameOf, object, walk } from "../domain/normalize";
import { cartSchema, contextSchema, editable, mcdArguments, quoteOrder, setCart, setContext } from "../domain/orders";
import { money } from "../domain/types";
import type { AgentReply, Emit, JsonObject, ModelMessage, Session, ToolDefinition } from "../domain/types";
import { mcpToolName, type OrderingProvider } from "../providers/types";
import type { ModelClient } from "./model";
import { systemPrompt } from "./prompt";

const replySchema = z.object({ text: z.string().min(1).max(900), expression: z.enum(["neutral", "happy", "thinking", "smug", "surprised", "sorry"]), choices: z.array(z.string().min(1).max(65)).max(3) }).strict();
const tool = (name: string, description: string, schema: JsonObject): ToolDefinition => ({ type: "function", function: { name, description, parameters: schema } });
const locals = [
  tool("set_order_context", "设置已查询、已由客人选择的就餐方式、门店、地址、取餐方式或餐具备注。变更门店/方式/地址会清空旧餐品。", z.toJSONSchema(contextSchema) as JsonObject),
  tool("set_cart", "用完整的新 items 列表更新点单：保留未改的餐品。先查菜单与每份餐品详情；支持套餐替换、特制、优惠券。空数组代表清空。", z.toJSONSchema(cartSchema) as JsonObject),
  tool("quote_order", "按程序当前点单调用官方算价，更新点单夹；所有价格都须以此结果为准。", { type: "object", properties: {}, additionalProperties: false }),
  tool("search_menu", "从已查询的本店菜单查找餐品，不发新网络请求。maxPriceYuan 仅按菜单参考价筛选，最终价格需正式计价。", { type: "object", properties: { query: { type: "string" }, maxPriceYuan: { type: "number" } }, additionalProperties: false }),
  tool("reply_to_guest", "结束本轮并让鲸鱼娘说话、切换表情、提供至多3个快捷回应。先读完所有依赖工具结果，再单独调用。", z.toJSONSchema(replySchema) as JsonObject),
];
const statusText: Record<string, string> = {
  query_nearby_stores: "让我找找附近的餐厅…", delivery_query_addresses: "正在查看配送地址…", delivery_query_stores: "正在确认可配送的餐厅…",
  query_meals: "正在翻看这家店的菜单…", query_meal_detail: "让我核对一下餐品选项…", query_store_coupons: "看看客人的优惠券能不能派上用场…",
  query_my_coupons: "正在查看已有优惠券…", set_cart: "正在认真记下客人的点单…", quote_order: "正在核对价格，马上递给你点单夹…",
  query_order: "正在查看订单进度…", order_list: "正在核实近期订单…", delivery_create_address: "正在保存客人提供的地址…",
};

function ingest(session: Session, name: string, result: unknown, args: JsonObject): unknown {
  const data = dataOf(result);
  if (name === "query-nearby-stores" || name === "delivery-query-stores") {
    const stores: unknown[] = [];
    walk(data, entry => { if (entry.storeCode && entry.storeName) { const id = key(entry.storeCode); if (!id) return; const store = { storeCode: id, storeName: String(entry.storeName), ...(entry.beCode ? { beCode: String(entry.beCode) } : {}), address: String(entry.address || "") }; session.stores[id] = store; stores.push(store); } });
    return { stores };
  }
  if (name === "delivery-query-addresses" || name === "delivery-create-address") {
    if (name === "delivery-create-address") session.addressWritePending = false;
    const addresses: unknown[] = [];
    walk(data, entry => { if (entry.addressId && (entry.fullAddress || entry.address)) { const id = key(entry.addressId); if (!id) return; const address = { addressId: id, fullAddress: String(entry.fullAddress ?? entry.address), contactName: String(entry.contactName || ""), phone: String(entry.phone || "") }; session.addresses[id] = address; addresses.push(address); } });
    return { addresses };
  }
  if (name === "query-meals") {
    session.catalog = {}; session.details = {};
    const meals = object(object(data).meals);
    for (const [code, value] of Object.entries(meals)) { const entry = object(value); if (key(code) && nameOf(entry)) session.catalog[code] = { code, name: nameOf(entry), currentPrice: entry.currentPrice, originalPrice: entry.originalPrice, discountType: entry.discountType }; }
    if (!Object.keys(session.catalog).length) walk(data, entry => {
      const code = key(entry.code ?? entry.productCode);
      if (code && nameOf(entry) && (entry.currentPrice !== undefined || entry.cents !== undefined)) session.catalog[code] = { code, name: nameOf(entry), currentPrice: entry.currentPrice, description: entry.description, category: entry.category };
    });
    return { total: Object.keys(session.catalog).length, meals: Object.values(session.catalog).slice(0, 55), notice: "只显示前55项；可调用 search_menu 查询其余菜品。价格是参考，须 quote_order 核价。" };
  }
  if (name === "query-meal-detail") {
    const code = String(args.code), detail = object(data);
    if (!Object.hasOwn(session.catalog, code) || (!detail.code && !detail.name)) throw new MgoError("MEAL_DETAIL_UNAVAILABLE", "餐品详情暂时不可用，请重新查询菜单。");
    session.details[code] = detail;
    return detail;
  }
  if (name === "query-store-coupons") {
    session.coupons = {};
    walk(data, entry => { if (key(entry.couponId) && entry.couponCode) session.coupons[String(entry.couponId)] = entry; });
    return { coupons: Object.values(session.coupons) };
  }
  const currentAttempt = session.attempt;
  if (name === "query-order" && currentAttempt && currentAttempt.orderId === args.orderId) {
    const entry = object(data);
    if (entry.orderStatus) currentAttempt.orderStatus = String(entry.orderStatus);
    if (entry.pickupCode) currentAttempt.pickupCode = String(entry.pickupCode);
  }
  return data;
}
export function prepareReadArguments(session: Session, name: string, args: JsonObject): JsonObject {
  if (["query-meals", "query-meal-detail", "query-store-coupons"].includes(name)) {
    const common = mcdArguments(session);
    const result: JsonObject = { storeCode: common.storeCode, orderType: common.orderType, beType: common.beType, ...(common.beCode ? { beCode: common.beCode } : {}) };
    if (name === "query-meal-detail") {
      const code = key(args.code);
      if (!code || !Object.hasOwn(session.catalog, code)) throw new MgoError("UNKNOWN_MEAL", "餐品编码必须来自当前门店菜单。");
      result.code = code;
    }
    return result;
  }
  if (name === "query-nearby-stores") return { beType: 1, searchType: args.city && args.keyword ? 2 : 1, ...(args.city && args.keyword ? { city: String(args.city), keyword: String(args.keyword) } : {}) };
  if (name === "delivery-query-stores") {
    const id = key(args.addressId ?? session.draft.address?.addressId);
    if (!id || !Object.hasOwn(session.addresses, id)) throw new MgoError("UNKNOWN_ADDRESS", "先查询并选择已保存的地址。");
    return { addressId: id, beType: 2 };
  }
  if (name === "query-order") {
    const orderId = String(args.orderId || session.attempt?.orderId || "");
    if (!orderId || ![session.attempt?.orderId, ...recentOrderIds(session)].includes(orderId)) throw new MgoError("UNKNOWN_ORDER", "先查询当前订单或近期订单，不能猜测订单编号。");
    return { orderId };
  }
  if (name === "delivery-create-address") {
    if (!/^1\d{10}$/.test(String(args.phone || ""))) throw new MgoError("INVALID_PHONE", "电话号码需要为11位中国大陆手机号。");
    const userText = session.messages.filter(m => m.role === "user").map(m => m.content || "").join(" ").replace(/\s/g, "");
    if (!/新增|添加|新地址|没有地址|地址是|送到/.test(userText)) throw new MgoError("ADDRESS_CONSENT", "新增地址需要客人明确提出。");
    for (const field of ["city", "contactName", "phone", "address", "addressDetail"]) {
      const value = String(args[field] || "").replace(/\s/g, "");
      if (!value || !userText.includes(field === "city" ? value.replace(/市$/, "") : value)) throw new MgoError("ADDRESS_INPUT_REQUIRED", "新增地址的城市、姓名、电话、地址和门牌必须由客人实际提供，请追问缺失信息。");
    }
    return args;
  }
  return {};
}
function recentOrderIds(session: Session) {
  const ids: string[] = [];
  for (const m of session.messages) if (m.role === "tool" && m.content) { try { walk(JSON.parse(m.content), entry => { if (entry.orderId) ids.push(String(entry.orderId)); }); } catch {} }
  return ids;
}
export async function runAgent(session: Session, provider: OrderingProvider, model: ModelClient, message: string, emit: Emit, signal?: AbortSignal): Promise<AgentReply> {
  if (session.mode !== provider.mode) throw new MgoError("MODE_MISMATCH", "体验模式与点餐服务不匹配，已停止操作。", 500);
  const definitions = [...await provider.listTools(), ...locals];
  const available = new Set(definitions.map(def => def.function.name));
  session.messages.push({ role: "user", content: message });
  let toolCount = 0;
  const messages: ModelMessage[] = [{ role: "system", content: systemPrompt(session) }, ...session.messages];
  for (let turn = 0; turn < 8; turn++) {
    if (signal?.aborted) throw new MgoError("TIMEOUT", "这次处理时间有点久，点单内容已保留。", 504);
    const response = await model.complete(messages, definitions, signal);
    if (!response.tool_calls?.length) {
      messages.push({ role: "system", content: "请调用 reply_to_guest 输出结构化回复；需要操作时先完成工具，不能只输出普通文本。" });
      continue;
    }
    messages.push(response); session.messages.push(response);
    const calls = response.tool_calls;
    let terminal: AgentReply | null = null;
    for (const call of calls) {
      if (++toolCount > 16) {
        const skipped: ModelMessage = { role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "TOOL_LIMIT", message: "本轮工具调用已达上限，请下一轮继续。" }) };
        messages.push(skipped); session.messages.push(skipped); continue;
      }
      const name = call.function.name;
      let value: unknown;
      try {
        if (!available.has(name)) throw new MgoError("TOOL_NOT_ALLOWED", "工具不在当前允许范围内。");
        const args = object(JSON.parse(call.function.arguments));
        if (name === "reply_to_guest") {
          if (calls.length !== 1) value = { error: "请先读取同轮其他工具结果，然后单独调用 reply_to_guest。" };
          else {
            terminal = replySchema.parse(args);
            if (session.quote && session.draft.fulfillment === "pickup" && !session.draft.takeWayCode && terminal.choices.some(choice => choice.includes("确认下单"))) {
              terminal = { text: `点单夹已核好啦，合计 ${money(session.quote.totalCents)}。客人还需要选一下取餐方式：${session.quote.takeWays.map(way => way.name).join("、")}。选好后我就把这项也记上。`, expression: "neutral", choices: session.quote.takeWays.slice(0, 3).map(way => way.name) };
            }
            value = { delivered: true };
          }
        } else {
          emit({ type: "status", text: statusText[name] || "鲸鱼娘正在处理…" });
          if (name === "set_order_context") value = setContext(session, args);
          else if (name === "set_cart") value = setCart(session, args);
          else if (name === "quote_order") { editable(session); value = await quoteOrder(session, provider, signal); }
          else if (name === "search_menu") {
            const terms = String(args.query || "").toLowerCase().split(/\s+/).filter(Boolean);
            const results = Object.values(session.catalog).filter(entry => (!terms.length || terms.some(term => nameOf(entry).toLowerCase().includes(term))) && (args.maxPriceYuan === undefined || Number(entry.currentPrice) <= Number(args.maxPriceYuan)));
            value = { total: results.length, meals: results.slice(0, 40) };
          } else {
            const native = mcpToolName(name), prepared = prepareReadArguments(session, native, args);
            if (native === "delivery-create-address") {
              editable(session);
              if (session.addressWritePending) throw new MgoError("ADDRESS_RESULT_UNKNOWN", "上次新增地址的结果待核实。请先查询地址列表并让客人选择已确认的地址，不要重复新增。");
              session.addressWritePending = true;
            }
            value = ingest(session, native, await provider.callTool(native, prepared, signal), prepared);
          }
        }
      } catch (error) {
        const mapped = error instanceof z.ZodError ? new MgoError("INVALID_ARGUMENTS", "工具参数格式不正确，请按 Schema 修正。") : publicError(error);
        value = { error: mapped.code, message: mapped.message };
      }
      const result: ModelMessage = { role: "tool", tool_call_id: call.id, content: clipJson(value, name === "query_meal_detail" ? 42000 : 20000) };
      messages.push(result); session.messages.push(result);
    }
    session.updatedAt = new Date().toISOString();
    if (terminal) {
      compactHistory(session); emit({ type: "state", session }); emit({ type: "reply", reply: terminal }); return terminal;
    }
    if (toolCount >= 16) break;
  }
  // Retain only complete user/assistant/tool sequences, even on a bounded-loop exit.
  const fallback: AgentReply = { text: "这次要核对的内容有一点多，先把已整理的点单留在这里。客人可以继续告诉我下一步，或者让我再核一下价格。", expression: "thinking", choices: ["看看现在点了什么", "再核一下价格"] };
  compactHistory(session); emit({ type: "state", session }); emit({ type: "reply", reply: fallback }); return fallback;
}
function compactHistory(session: Session) {
  if (session.messages.length <= 48) return;
  const start = session.messages.findIndex((message, index) => index >= session.messages.length - 48 && message.role === "user");
  if (start > 0) session.messages = session.messages.slice(start);
}
