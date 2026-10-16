export type AppMode = "demo" | "live";
export type Expression = "neutral" | "happy" | "thinking" | "smug" | "surprised" | "sorry";
export type JsonObject = Record<string, unknown>;
export type Fulfillment = "pickup" | "delivery";

export interface Store { storeCode: string; beCode?: string; storeName: string; address?: string }
export interface Address { addressId: string; fullAddress: string; contactName?: string; phone?: string }
export interface CartItem {
  lineId: string;
  productCode: string;
  name: string;
  quantity: number;
  couponId?: string;
  couponCode?: string;
  options: string[];
  roundList?: unknown[];
  modification?: JsonObject;
}
export interface OrderDraft {
  revision: number;
  fulfillment: Fulfillment | null;
  store: Store | null;
  address: Address | null;
  items: CartItem[];
  takeWayCode?: string;
  needTableware: boolean;
  remark: string;
}
export interface Quote {
  id: string;
  revision: number;
  fingerprint: string;
  productCents: number;
  deliveryCents: number;
  tablewareCents: number;
  discountCents: number;
  totalCents: number;
  lines: { name: string; quantity: number; subtotalCents: number }[];
  takeWays: { code: string; name: string }[];
  createdAt: string;
}
export interface OrderAttempt {
  id: string;
  quoteId: string;
  requestId: string;
  status: "submitting" | "created" | "unknown" | "failed";
  orderId?: string;
  paymentUrl?: string;
  orderStatus?: string;
  pickupCode?: string;
  message?: string;
  createdAt: string;
}
export interface Preferences { budget?: number; tastes: string[] }
export interface AgentReply { text: string; expression: Expression; choices: string[] }
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: JsonObject };
}
export interface Session {
  id: string;
  mode: AppMode;
  draft: OrderDraft;
  quote: Quote | null;
  attempt: OrderAttempt | null;
  messages: ModelMessage[];
  catalog: Record<string, JsonObject>;
  details: Record<string, JsonObject>;
  stores: Record<string, Store>;
  addresses: Record<string, Address>;
  coupons: Record<string, JsonObject>;
  preferences: Preferences;
  addressWritePending?: boolean;
  updatedAt: string;
}
export type StreamEvent =
  | { type: "utterance_start"; utteranceId: string; phase: "progress" | "final"; expression: Expression }
  | { type: "utterance_delta"; utteranceId: string; text: string }
  | { type: "utterance_end"; utteranceId: string; reply: AgentReply; interrupted?: boolean }
  | { type: "status"; text: string }
  | { type: "state"; session: Session }
  | { type: "reply"; reply: AgentReply; utteranceId?: string }
  | { type: "error"; code: string; message: string }
  | { type: "done" };
export type Emit = (event: StreamEvent) => void;

export function newSession(mode: AppMode, id = crypto.randomUUID()): Session {
  return {
    id, mode,
    draft: { revision: 0, fulfillment: null, store: null, address: null, items: [], needTableware: false, remark: "" },
    quote: null, attempt: null, messages: [], catalog: {}, details: {}, stores: {}, addresses: {}, coupons: {},
    preferences: { tastes: [] }, updatedAt: new Date().toISOString(),
  };
}
export const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
