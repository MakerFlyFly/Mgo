import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import Ajv, { type ValidateFunction } from "ajv";
import { MgoError } from "../domain/errors";
import type { JsonObject, ToolDefinition } from "../domain/types";
import { READ_TOOLS, WRITE_TOOLS, modelToolName, type OrderingProvider } from "./types";

const allowed = new Set<string>([...READ_TOOLS, ...WRITE_TOOLS]);
export class McdOrderingProvider implements OrderingProvider {
  readonly mode = "live" as const;
  private client: Client | null = null;
  private validators = new Map<string, ValidateFunction>();
  private definitions: ToolDefinition[] = [];
  constructor(private token: string) {}
  private async connect() {
    if (this.client) return;
    if (!this.token) throw new MgoError("MCD_NOT_CONFIGURED", "请先在本地环境变量中配置 MCD_MCP_TOKEN。", 503);
    const client = new Client({ name: "mgo", version: "0.1.0" });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.mcd.cn"), {
        requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
      }), { timeout: 20000 });
      const tools = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools); cursor = page.nextCursor;
      } while (cursor && tools.length < 150);
      const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
      for (const tool of tools) {
        if (!allowed.has(tool.name)) continue;
        this.validators.set(tool.name, ajv.compile(tool.inputSchema));
        if (tool.name === "create-order" || tool.name === "calculate-price") continue;
        this.definitions.push({ type: "function", function: {
          name: modelToolName(tool.name), description: tool.description || tool.name,
          parameters: tool.inputSchema as JsonObject,
        } });
      }
      for (const required of ["query-meals", "query-meal-detail", "calculate-price", "create-order"]) {
        if (!this.validators.has(required)) throw new MgoError("MCP_INCOMPATIBLE", "当前 MCP 工具不完整，暂时无法点餐。", 503);
      }
      this.client = client;
    } catch (error) {
      await client.close().catch(() => {});
      if (error instanceof MgoError) throw error;
      throw this.mapError(error);
    }
  }
  async listTools() { await this.connect(); return this.definitions; }
  async callTool(name: string, args: JsonObject, signal?: AbortSignal): Promise<unknown> {
    if (!allowed.has(name)) throw new MgoError("TOOL_NOT_ALLOWED", "该工具未在本项目开放。");
    await this.connect();
    const validate = this.validators.get(name);
    if (!validate || !validate(args)) throw new MgoError("INVALID_TOOL_ARGUMENTS", "工具参数缺少必要字段或格式不符，请根据 Schema 修正。");
    const retries = (READ_TOOLS as readonly string[]).includes(name) ? 1 : 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.client!.callTool({ name, arguments: args }, { signal, timeout: 25000 });
        const structured = "structuredContent" in result ? result.structuredContent : undefined;
        const content = Array.isArray(result.content) ? result.content : [];
        const raw = structured ?? content.filter(c => c.type === "text").map(c => "text" in c ? c.text : "").join("\n");
        let parsed: unknown = raw;
        if (typeof raw === "string") { try { parsed = JSON.parse(raw); } catch { /* some coupon tools return Markdown */ } }
        if (result.isError) throw new MgoError("MCP_TOOL_ERROR", "麦当劳接口未完成这项操作，请核实参数或稍后重试。", 502);
        if (parsed && typeof parsed === "object" && "success" in parsed && parsed.success === false) {
          const data = parsed as JsonObject;
          const code = Number(data.code);
          throw new MgoError("MCP_REJECTED", code === 401 ? "麦当劳 Token 无效或已过期。" : "麦当劳接口未接受当前请求，请检查餐品、门店或优惠条件。", code === 401 ? 401 : 422);
        }
        return parsed;
      } catch (error) {
        const mapped = error instanceof MgoError ? error : this.mapError(error);
        if (attempt >= retries || !mapped.retryable || signal?.aborted) throw mapped;
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }
  }
  private mapError(error: unknown) {
    const e = error as { code?: number; status?: number; message?: string; name?: string };
    const status = e.status || (/\b401\b/.test(e.message || "") ? 401 : /\b429\b/.test(e.message || "") ? 429 : 502);
    if (status === 401) return new MgoError("MCD_AUTH", "麦当劳 Token 无效或已过期，请在本地更新后重启。", 401);
    if (status === 429) return new MgoError("MCD_RATE_LIMIT", "麦当劳接口暂时繁忙，请稍后再试。", 429, true);
    if (e.name === "AbortError" || /timeout|timed out/i.test(e.message || "")) return new MgoError("TIMEOUT", "等待麦当劳接口响应超时。", 504, true);
    return new MgoError("MCP_CONNECTION", "暂时无法连接麦当劳服务，请稍后再试。", 502, true);
  }
  async close() { await this.client?.close().catch(() => {}); this.client = null; }
}
