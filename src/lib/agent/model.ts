import { MgoError } from "../domain/errors";
import type { ModelMessage, ToolDefinition } from "../domain/types";

export interface ModelClient {
  complete(messages: ModelMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<ModelMessage>;
}
export class DeepSeekModel implements ModelClient {
  constructor(private apiKey: string, private model: string) {}
  async complete(messages: ModelMessage[], tools: ToolDefinition[], signal?: AbortSignal): Promise<ModelMessage> {
    if (!this.apiKey) throw new MgoError("DEEPSEEK_KEY_REQUIRED", "先在设置里填入你的 DeepSeek Key，就可以和我聊天啦。", 401);
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", cache: "no-store", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages, tools, tool_choice: "auto", thinking: { type: "disabled" }, temperature: 0.65, max_tokens: 3000 }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new MgoError("DEEPSEEK_AUTH", "DeepSeek Key 无效，请检查设置。", 401);
      if (response.status === 402) throw new MgoError("DEEPSEEK_BALANCE", "这枚 DeepSeek Key 的账户余额不足，请充值或更换 Key。", 402);
      if (response.status === 429) throw new MgoError("DEEPSEEK_RATE_LIMIT", "DeepSeek 暂时繁忙，稍等一会儿再试吧。", 429);
      throw new MgoError("DEEPSEEK_UNAVAILABLE", "DeepSeek 暂时没有回应，你的点单内容仍在。", 502);
    }
    const result = await response.json();
    const message = result.choices?.[0]?.message;
    if (!message) throw new MgoError("MODEL_RESPONSE", "这次回复没有完成，请再试一次。", 502);
    // Never retain reasoning_content, upstream metadata, or credentials in game state.
    return { role: "assistant", content: typeof message.content === "string" ? message.content : null, ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {}) };
  }
}
