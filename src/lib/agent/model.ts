import { MgoError } from "../domain/errors";
import type { ModelMessage, ToolDefinition } from "../domain/types";
import { sseData } from "../streaming/sse";

export type ModelToolDelta = { index: number; id: string; name: string; arguments: string };

export interface ModelClient {
  complete(messages: ModelMessage[], tools: ToolDefinition[], signal?: AbortSignal, onToolDelta?: (delta: ModelToolDelta) => void): Promise<ModelMessage>;
}
export class DeepSeekModel implements ModelClient {
  constructor(private apiKey: string, private model: string) {}
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal?: AbortSignal, onToolDelta?: (delta: ModelToolDelta) => void): Promise<ModelMessage> {
    if (!this.apiKey) throw new MgoError("DEEPSEEK_KEY_REQUIRED", "先在设置里填入你的 DeepSeek Key，就可以和我聊天啦。", 401);
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, tools, tool_choice: "auto", stream: true, thinking: { type: "disabled" }, temperature: 0.65, max_tokens: 3000 }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new MgoError("DEEPSEEK_AUTH", "DeepSeek Key 无效，请检查设置。", 401);
      if (response.status === 402) throw new MgoError("DEEPSEEK_BALANCE", "这枚 DeepSeek Key 的账户余额不足，请充值或更换 Key。", 402);
      if (response.status === 429) throw new MgoError("DEEPSEEK_RATE_LIMIT", "DeepSeek 暂时繁忙，稍等一会儿再试吧。", 429);
      throw new MgoError("DEEPSEEK_UNAVAILABLE", "DeepSeek 暂时没有回应，你的点单内容仍在。", 502);
    }
    if (!response.body) throw new MgoError("MODEL_RESPONSE", "这次回复没有完成，请再试一次。", 502);
    const calls = new Map<number, ModelToolDelta>();
    let content = "", finished = "", done = false;
    for await (const data of sseData(response.body)) {
      if (data === "[DONE]") { done = true; break; }
      const chunk = JSON.parse(data), choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finished = choice.finish_reason;
      if (typeof choice.delta?.content === "string") content += choice.delta.content;
      for (const fragment of choice.delta?.tool_calls || []) {
        if (!Number.isInteger(fragment.index) || fragment.index < 0 || fragment.index > 15) throw new MgoError("MODEL_RESPONSE", "这次工具回复格式不完整。", 502);
        let call = calls.get(fragment.index);
        if (!call) { call = { index: fragment.index, id: "", name: "", arguments: "" }; calls.set(fragment.index, call); }
        if (fragment.id) call.id += fragment.id;
        if (fragment.function?.name) call.name += fragment.function.name;
        if (fragment.function?.arguments) call.arguments += fragment.function.arguments;
        if (call.arguments.length > 150000) throw new MgoError("MODEL_RESPONSE", "这次回复内容过长，请缩小点单范围。", 502);
        onToolDelta?.({ ...call });
      }
    }
    if (!done || !["stop", "tool_calls"].includes(finished)) throw new MgoError("MODEL_STREAM_INTERRUPTED", "这段回复中断了，已整理的点单仍保留。请再告诉我下一步。", 502);
    const toolCalls = [...calls.values()].sort((a, b) => a.index - b.index).map((call, index) => {
      if (call.index !== index) throw new MgoError("MODEL_RESPONSE", "这次工具回复格式不完整。", 502);
      if (!call.id || !call.name) throw new MgoError("MODEL_RESPONSE", "这次工具回复格式不完整。", 502);
      try { JSON.parse(call.arguments); } catch { throw new MgoError("MODEL_RESPONSE", "这段回复没有完整生成，请再试一次。", 502); }
      return { id: call.id, type: "function" as const, function: { name: call.name, arguments: call.arguments } };
    });
    // Never retain reasoning_content, upstream metadata, or credentials in game state.
    return { role: "assistant", content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  }
}
