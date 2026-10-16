import { MgoError } from "../domain/errors";
import type { JsonObject, ToolDefinition } from "../domain/types";
import { DEMO_COUPONS, DEMO_MEALS, demoDetail } from "./fixtures";
import { modelToolName, type OrderingProvider } from "./types";

const s = { type: "string" }, n = { type: "number" };
const definitions: Record<string, [string, JsonObject, string[]?]> = {
  "query-nearby-stores": ["查询自取门店。按城市和地标搜索，或查询收藏门店。", { searchType: { type: "integer", enum: [1, 2] }, city: s, keyword: s, beType: { type: "integer", enum: [1] } }],
  "delivery-query-addresses": ["查询当前账户的已保存外送地址。", {}],
  "delivery-create-address": ["仅在客人明确要求新增地址时使用。城市、姓名、电话、地址、门牌均必须由客人提供。", { city: s, contactName: s, phone: s, address: s, addressDetail: s }, ["city", "contactName", "phone", "address", "addressDetail"]],
  "delivery-query-stores": ["查询配送到已选地址的门店。", { addressId: s, beType: { type: "integer", enum: [2] } }, ["addressId"]],
  "query-meals": ["查询已选门店当前菜单。", { storeCode: s, beCode: s, orderType: n, beType: n }],
  "query-meal-detail": ["查询餐品、套餐组成及可选特制。加进点单前先查询。", { code: s, storeCode: s, beCode: s, orderType: n, beType: n }, ["code"]],
  "query-store-coupons": ["查询已选门店、就餐方式下可使用的优惠券。", { storeCode: s, beCode: s, orderType: n, beType: n }],
  "query-my-coupons": ["查询已拥有的优惠券。优惠是否可用于当前门店仍需查询门店券。", {}],
  "query-order": ["查询订单状态。", { orderId: s }, ["orderId"]],
  "order-list": ["查询近期订单，用于协助核实提交状态。", {}],
};

export class MockOrderingProvider implements OrderingProvider {
  readonly mode = "demo" as const;
  constructor(private options: { priceDelta?: number; failCreate?: boolean } = {}) {}
  async listTools(): Promise<ToolDefinition[]> {
    return Object.entries(definitions).map(([name, [description, properties, required]]) => ({
      type: "function", function: { name: modelToolName(name), description, parameters: { type: "object", properties, ...(required ? { required } : {}), additionalProperties: false } },
    }));
  }
  async callTool(name: string, args: JsonObject): Promise<unknown> {
    switch (name) {
      case "query-nearby-stores": {
        const city = String(args.city || "上海市");
        const keyword = String(args.keyword || "云端步行街").slice(0, 40);
        return { success: true, data: [
          { storeCode: "DEMO-001", beCode: "DEMO-BE-001", storeName: `${city}${keyword}云体验店`, address: `${city}云端步行街 18 号（模拟门店）` },
          { storeCode: "DEMO-002", beCode: "DEMO-BE-002", storeName: `${city}星光广场云体验店`, address: `${city}星光广场 2 号（模拟门店）` },
        ] };
      }
      case "delivery-query-addresses": return { success: true, data: { addresses: [
        { addressId: "DEMO-ADDRESS", fullAddress: "上海市云端花园 1 号楼 101 室（模拟地址）", contactName: "体验客人", phone: "138****0000" },
      ] } };
      case "delivery-create-address": {
        for (const key of ["city", "contactName", "phone", "address", "addressDetail"]) if (!args[key]) throw new MgoError("ADDRESS_INCOMPLETE", "新增地址还缺少必要信息。");
        if (!/^1\d{10}$/.test(String(args.phone))) throw new MgoError("INVALID_PHONE", "电话号码需要为11位中国大陆手机号。");
        return { success: true, data: { addressId: `DEMO-${crypto.randomUUID()}`, contactName: args.contactName, phone: String(args.phone).replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"), fullAddress: `${args.city}${args.address}${args.addressDetail}（模拟地址）` } };
      }
      case "delivery-query-stores": return { success: true, data: [{ storeCode: "DEMO-DELIVERY", beCode: "DEMO-BE-DELIVERY", storeName: "麦当劳云端配送体验店", address: "模拟配送门店" }] };
      case "query-meals": return { success: true, data: Object.entries(DEMO_MEALS).map(([code, meal]) => ({ code, ...meal, currentPrice: (meal.cents / 100).toFixed(2) })) };
      case "query-meal-detail": {
        const code = String(args.code);
        if (!DEMO_MEALS[code]) throw new MgoError("MEAL_UNAVAILABLE", "这份餐品不在当前菜单中。");
        return { success: true, data: demoDetail(code) };
      }
      case "query-store-coupons": case "query-my-coupons": return { success: true, data: DEMO_COUPONS.map(c => ({ ...c, products: [{ productCode: c.productCode, productName: DEMO_MEALS[c.productCode].name }] })) };
      case "calculate-price": return this.calculate(args);
      case "create-order": {
        if (this.options.failCreate) throw new MgoError("TIMEOUT", "模拟订单提交超时。", 504);
        const price = this.calculate(args) as { data: { price: number } };
        return { success: true, data: { orderId: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, orderDetail: { orderStatus: "模拟订单已创建", realTotalAmount: (price.data.price / 100).toFixed(2), pickupCode: "MGO-018" } } };
      }
      case "query-order": return { success: true, data: { orderId: args.orderId, orderStatus: "模拟订单 · 等待云端出餐", pickupCode: "MGO-018" } };
      case "order-list": return { success: true, data: { list: [], notice: "演示不连接真实账户。当前模拟订单请查看点单夹。" } };
      default: throw new MgoError("TOOL_NOT_ALLOWED", "当前体验暂不支持这项操作。");
    }
  }
  private calculate(args: JsonObject) {
    const items = args.items as JsonObject[];
    if (!Array.isArray(items) || !items.length) throw new MgoError("EMPTY_CART", "请先选一些餐品。");
    let productCents = 0, discountCents = 0;
    const usedCoupons = new Set<string>();
    const lines = items.map(item => {
      const code = String(item.productCode), meal = DEMO_MEALS[code], quantity = Number(item.quantity);
      if (!meal || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new MgoError("INVALID_ITEM", "餐品或数量无效。");
      let unitPrice = meal.cents;
      if (Array.isArray(item.roundList)) for (const group of item.roundList as JsonObject[]) {
        for (const choice of (group.comboItemList || []) as JsonObject[]) {
          if (String(choice.code) === "4003") unitPrice += 300;
        }
      }
      let discount = 0;
      if (item.couponId) {
        const coupon = DEMO_COUPONS.find(c => c.couponId === item.couponId && c.productCode === code && c.couponCode === item.couponCode);
        if (!coupon || usedCoupons.has(coupon.couponId) || quantity !== 1) throw new MgoError("COUPON_UNAVAILABLE", "这张券不适用于当前餐品或数量，每张体验券限用一次。");
        usedCoupons.add(coupon.couponId); discount = coupon.discountCents;
      }
      productCents += unitPrice * quantity; discountCents += discount;
      return { productCode: code, productName: meal.name, quantity, subtotal: unitPrice * quantity - discount };
    });
    const delivery = Number(args.beType) === 2 ? 600 : 0, tableware = args.needTableware ? 30 : 0;
    return { success: true, data: {
      productPrice: productCents - discountCents, productOriginalPrice: productCents,
      deliveryPrice: delivery, deliveryOriginalPrice: delivery, tablewarePrice: tableware,
      discount: discountCents, price: productCents - discountCents + delivery + tableware + (this.options.priceDelta || 0),
      productList: lines,
      takeWayList: Number(args.beType) === 2 ? [] : [{ code: "counter", name: "柜台取餐" }, { code: "takeaway", name: "打包带走" }],
    } };
  }
  async close() {}
}
