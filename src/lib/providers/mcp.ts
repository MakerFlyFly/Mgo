import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import Ajv, { type ValidateFunction } from "ajv";
import { MgoError } from "../domain/errors";
import type { JsonObject } from "../domain/types";
import type { AgentTrace } from "../agent/trace";
import { READ_TOOLS, WRITE_TOOLS, type OrderingProvider } from "./types";
import { orderingTools } from "./definitions";
import { ResourcePool, type PoolLease } from "./resource-pool";

const allowed = new Set<string>([...READ_TOOLS, ...WRITE_TOOLS]);
type Connection = { client: Client; validators: Map<string, ValidateFunction>; close(): Promise<void> };
const pool = new ResourcePool<Connection>(60000);

function withAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
    if (signal.aborted) aborted(); else signal.addEventListener("abort", aborted, { once: true });
    pending.then(value => { signal.removeEventListener("abort", aborted); resolve(value); }, error => { signal.removeEventListener("abort", aborted); reject(error); });
  });
}

async function openConnection(token: string): Promise<Connection> {
  const client = new Client({ name: "mgo", version: "0.1.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.mcd.cn"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }), { timeout: 20000 });
    const validators = new Map<string, ValidateFunction>();
    const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
    let cursor: string | undefined, count = 0;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 20000 });
      for (const tool of page.tools) if (allowed.has(tool.name)) validators.set(tool.name, ajv.compile(tool.inputSchema));
      count += page.tools.length; cursor = page.nextCursor;
    } while (cursor && count < 150);
    for (const required of ["query-meals", "query-meal-detail", "calculate-price", "create-order"]) {
      if (!validators.has(required)) throw new MgoError("MCP_INCOMPATIBLE", "当前 MCP 工具不完整，暂时无法点餐。", 503);
    }
    return { client, validators, close: async () => { await client.close().catch(() => {}); } };
  } catch (error) { await client.close().catch(() => {}); throw error; }
}

export class McdOrderingProvider implements OrderingProvider {
  readonly mode = "live" as const;
  private lease: PoolLease<Connection> | null = null;
  private connecting: Promise<Connection> | null = null;
  private generation = 0;
  constructor(private token: string, private trace?: AgentTrace) {}
  // Listing Mgo's public business tools is entirely local, including for invalid credentials.
  async listTools() { return orderingTools(); }

  private async connect(): Promise<Connection> {
    if (this.lease) return this.lease.resource;
    if (this.connecting) return this.connecting;
    if (!this.token) throw new MgoError("MCD_NOT_CONFIGURED", "点餐前请在本地配置 MCD_MCP_TOKEN，闲聊仍可继续。", 503);
    const account = createHash("sha256").update(this.token).digest("hex");
    const generation = this.generation;
    this.connecting = (async () => {
      const lease = await pool.acquire(account, () => this.trace ? this.trace.mcp(() => openConnection(this.token)) : openConnection(this.token));
      if (generation !== this.generation) { lease.release(); throw new MgoError("TIMEOUT", "等待连接的请求已结束。", 504); }
      this.lease = lease;
      return this.lease.resource;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }

  async callTool(name: string, args: JsonObject, signal?: AbortSignal): Promise<unknown> {
    if (!allowed.has(name)) throw new MgoError("TOOL_NOT_ALLOWED", "该工具未在本项目开放。");
    const retries = (READ_TOOLS as readonly string[]).includes(name) ? 1 : 0;
    for (let attempt = 0; ; attempt++) {
      try {
        signal?.throwIfAborted();
        const connection = await withAbort(this.connect(), signal);
        signal?.throwIfAborted();
        const validate = connection.validators.get(name);
        if (!validate || !validate(args)) throw new MgoError("INVALID_TOOL_ARGUMENTS", "工具参数缺少必要字段或格式不符，请根据 Schema 修正。");
        const result = await connection.client.callTool({ name, arguments: args }, { signal, timeout: 25000 });
        const structured = "structuredContent" in result ? result.structuredContent : undefined;
        const content = Array.isArray(result.content) ? result.content : [];
        const raw = structured ?? content.filter(c => c.type === "text").map(c => "text" in c ? c.text : "").join("\n");
        let parsed: unknown = raw;
        if (typeof raw === "string") { try { parsed = JSON.parse(raw); } catch { /* coupon tools may return Markdown */ } }
        if (result.isError) throw new MgoError("MCP_TOOL_ERROR", "麦当劳接口未完成这项操作，请核实参数或稍后重试。", 502);
        if (parsed && typeof parsed === "object" && "success" in parsed && parsed.success === false) {
          const code = Number((parsed as JsonObject).code);
          throw new MgoError(code === 401 ? "MCD_AUTH" : "MCP_REJECTED", code === 401 ? "麦当劳 Token 无效或已过期，闲聊仍可继续。" : "麦当劳接口未接受当前请求，请检查餐品、门店或优惠条件。", code === 401 ? 401 : 422);
        }
        return parsed;
      } catch (error) {
        const mapped = error instanceof MgoError ? error : this.mapError(error);
        if (["MCD_AUTH", "MCP_CONNECTION", "TIMEOUT"].includes(mapped.code)) { this.lease?.invalidate(); await this.close(); }
        if (attempt >= retries || !mapped.retryable || signal?.aborted) throw mapped;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
  }
  private mapError(error: unknown) {
    const e = error as { code?: number; status?: number; message?: string; name?: string };
    const status = e.status || (/\b401\b/.test(e.message || "") ? 401 : /\b429\b/.test(e.message || "") ? 429 : 502);
    if (status === 401) return new MgoError("MCD_AUTH", "麦当劳 Token 无效或已过期，请在本地更新后重启。闲聊仍可继续。", 401);
    if (status === 429) return new MgoError("MCD_RATE_LIMIT", "麦当劳接口暂时繁忙，请稍后再试。", 429, true);
    if (e.name === "AbortError" || /timeout|timed out/i.test(e.message || "")) return new MgoError("TIMEOUT", "等待麦当劳接口响应超时。", 504, true);
    return new MgoError("MCP_CONNECTION", "暂时无法连接麦当劳服务，闲聊仍可继续。", 502, true);
  }
  async close() { this.generation++; this.lease?.release(); this.lease = null; }
}
