import type { JsonObject, ToolDefinition } from "../domain/types";

export const READ_TOOLS = [
  "query-nearby-stores", "delivery-query-addresses", "delivery-query-stores", "query-meals",
  "query-meal-detail", "query-store-coupons", "query-my-coupons", "calculate-price", "query-order", "order-list",
] as const;
export const WRITE_TOOLS = ["delivery-create-address", "create-order"] as const;
export interface OrderingProvider {
  readonly mode: "demo" | "live";
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: JsonObject, signal?: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
export const modelToolName = (name: string) => name.replaceAll("-", "_");
export const mcpToolName = (name: string) => name.replaceAll("_", "-");
