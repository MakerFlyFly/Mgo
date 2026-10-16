import { z } from "zod";
import { cartSchema } from "../domain/orders";
import type { Session } from "../domain/types";
import { tasteOptions } from "../domain/preferences";

export const preferencesSchema = z.object({ budget: z.number().min(1).max(1000).optional(), tastes: z.array(z.enum(tasteOptions)).max(7) }).strict();
const store = z.object({ storeCode: z.string().max(150), storeName: z.string().max(200), beCode: z.string().max(150).optional(), address: z.string().max(300).optional() });
const address = z.object({ addressId: z.string().max(150), fullAddress: z.string().max(300), contactName: z.string().max(50).optional(), phone: z.string().max(30).optional() });
const cents = z.number().int().min(0).max(100_000_000);
const quote = z.object({ id: z.string().uuid(), revision: z.number().int().min(0), fingerprint: z.string().length(64), productCents: cents, deliveryCents: cents, tablewareCents: cents, discountCents: cents, totalCents: cents, lines: z.array(z.object({ name: z.string().max(200), quantity: z.number().int().min(1).max(50), subtotalCents: cents })).max(50), takeWays: z.array(z.object({ code: z.string().max(150), name: z.string().max(100) })).max(20), createdAt: z.string().max(50) });
const attempt = z.object({ id: z.string().uuid(), quoteId: z.string().uuid(), requestId: z.string().uuid(), status: z.enum(["submitting", "created", "unknown", "failed"]), orderId: z.string().max(160).optional(), orderStatus: z.string().max(200).optional(), pickupCode: z.string().max(100).optional(), message: z.string().max(500).optional(), createdAt: z.string().max(50) });
const message = z.object({ role: z.enum(["user", "assistant", "tool"]), content: z.string().max(50000).nullable(), tool_call_id: z.string().max(200).optional(), tool_calls: z.array(z.object({ id: z.string().max(200), type: z.literal("function"), function: z.object({ name: z.string().max(150), arguments: z.string().max(30000) }) })).max(16).optional() });
const entryRecord = z.record(z.string().max(150), z.record(z.string(), z.unknown()));
export const demoSessionSchema = z.object({
  id: z.string().uuid(), mode: z.literal("demo"),
  draft: z.object({ revision: z.number().int().min(0), fulfillment: z.enum(["pickup", "delivery"]).nullable(), store: store.nullable(), address: address.nullable(), items: z.array(cartSchema.shape.items.element.extend({ lineId: z.string().max(150), name: z.string().max(200), options: z.array(z.string().max(200)).max(40) })).max(30), takeWayCode: z.string().max(150).optional(), needTableware: z.boolean(), remark: z.string().max(50) }),
  quote: quote.nullable(), attempt: attempt.nullable(), messages: z.array(message).max(128), catalog: entryRecord, details: entryRecord,
  stores: z.record(z.string().max(150), store), addresses: z.record(z.string().max(150), address), coupons: entryRecord,
  preferences: preferencesSchema, addressWritePending: z.boolean().optional(), updatedAt: z.string().max(50),
});
export const chatRequestSchema = z.object({
  message: z.string().max(1500).default(""), requestId: z.string().uuid(), quoteId: z.string().uuid().optional(),
  apiKey: z.string().trim().max(512).optional(), demoState: demoSessionSchema.optional(),
  preferences: preferencesSchema.optional(), reset: z.boolean().optional(),
}).strict();
export function parseDemoSession(value: unknown): Session { return demoSessionSchema.parse(value) as Session; }
