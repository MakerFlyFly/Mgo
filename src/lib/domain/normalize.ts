import type { JsonObject } from "./types";

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
export function dataOf(value: unknown): unknown {
  const valueObject = object(value);
  return Object.hasOwn(valueObject, "data") ? valueObject.data : value;
}
export function walk(value: unknown, visit: (entry: JsonObject) => void, depth = 0, budget = { left: 30000 }) {
  if (depth > 16 || --budget.left < 0 || value === null || typeof value !== "object") return;
  if (!Array.isArray(value)) visit(value as JsonObject);
  for (const child of Object.values(value)) if (child !== null && typeof child === "object") walk(child, visit, depth + 1, budget);
}
export function key(value: unknown): string {
  const result = String(value ?? "");
  return result && result.length < 160 && !["__proto__", "prototype", "constructor"].includes(result) ? result : "";
}
export function namedCode(value: JsonObject) { return key(value.productCode ?? value.code); }
export function nameOf(value: JsonObject) { return String(value.productName ?? value.name ?? value.title ?? ""); }
export function integerCents(value: unknown): number {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result) || result < 0 || result > 100_000_000) throw new Error("Invalid monetary amount");
  return result;
}
export function clipJson(value: unknown, limit = 24000) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return serialized.length > limit ? serialized.slice(0, limit) + "\n[结果已截断；请缩小查询范围]" : serialized;
}
