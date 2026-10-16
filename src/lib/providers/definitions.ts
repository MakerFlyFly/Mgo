import type { JsonObject, ToolDefinition } from "../domain/types";
import { modelToolName } from "./types";

const string = { type: "string" };
// These are Mgo business tools. Official MCP schemas are checked only on invocation.
const definitions: [string, string, JsonObject, string[]?][] = [
  ["query-nearby-stores", "查询城市、地标附近的自取门店；信息缺失时先询问客人。", { city: string, keyword: string }],
  ["delivery-query-addresses", "查询客人已保存的外送地址。", {}],
  ["delivery-create-address", "客人明确要求且亲自提供全部信息后新增地址。", { city: string, contactName: string, phone: string, address: string, addressDetail: string }, ["city", "contactName", "phone", "address", "addressDetail"]],
  ["delivery-query-stores", "查询配送到已选择地址的门店。", { addressId: string }, ["addressId"]],
  ["query-meals", "查询当前已选门店菜单；上下文由程序填写。", {}],
  ["query-meal-detail", "查询当前菜单餐品的套餐轮次、选项和特制。", { code: string }, ["code"]],
  ["query-store-coupons", "查询当前门店和就餐方式可用的优惠券。", {}],
  ["query-my-coupons", "查询客人已有优惠券。", {}],
  ["query-order", "查询当前或已经查询到的近期订单。", { orderId: string }, ["orderId"]],
  ["order-list", "查询近期订单以协助核实提交结果。", {}],
];
export function orderingTools(): ToolDefinition[] {
  return definitions.map(([name, description, properties, required]) => ({ type: "function", function: { name: modelToolName(name), description, parameters: { type: "object", properties, ...(required ? { required } : {}), additionalProperties: false } } }));
}
