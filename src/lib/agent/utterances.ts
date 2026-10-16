import type { AgentReply, Emit, Expression } from "../domain/types";
import { expressionValues } from "../domain/types";
import { topLevelStringPrefix } from "../streaming/json-text";
import type { ModelToolDelta } from "./model";
import type { AgentTrace } from "./trace";

type Pending = { id: string; name: string; phase: "progress" | "final"; text: string; expression: Expression; started: boolean; ended: boolean };
const expressions = new Set<string>(expressionValues);
export class UtteranceStream {
  private pending = new Map<number, Pending>();
  constructor(private emit: Emit, private remainingTools: number, private remainingNarrations: number, private holdFinal: boolean, private trace?: AgentTrace) {}
  delta = (call: ModelToolDelta) => {
    if (call.index >= this.remainingTools || !["narrate_to_guest", "reply_to_guest"].includes(call.name)) return;
    if (call.name === "narrate_to_guest" && this.remainingNarrations <= 0) return;
    if (call.name === "reply_to_guest" && this.holdFinal) return;
    let item = this.pending.get(call.index);
    if (!item) {
      if (call.name === "narrate_to_guest" && [...this.pending.values()].filter(p => p.phase === "progress").length >= this.remainingNarrations) return;
      item = { id: crypto.randomUUID(), name: call.name, phase: call.name === "reply_to_guest" ? "final" : "progress", text: "", expression: "neutral", started: false, ended: false };
      this.pending.set(call.index, item);
    }
    const expression = topLevelStringPrefix(call.arguments, "expression");
    if (expression && expressions.has(expression)) item.expression = expression as Expression;
    const text = topLevelStringPrefix(call.arguments, "text");
    if (!text || !text.startsWith(item.text) || item.ended) return;
    const limited = Array.from(text).slice(0, item.phase === "progress" ? 80 : 900).join("");
    if (limited.length === item.text.length) return;
    this.start(item); this.trace?.firstText();
    this.emit({ type: "utterance_delta", utteranceId: item.id, text: limited.slice(item.text.length) }); item.text = limited;
  };
  private start(item: Pending) {
    if (item.started) return; item.started = true;
    this.emit({ type: "utterance_start", utteranceId: item.id, phase: item.phase, expression: item.expression });
  }
  commit(index: number, reply: AgentReply, phase: "progress" | "final"): string {
    let item = this.pending.get(index);
    if (item && (item.ended || !reply.text.startsWith(item.text))) { this.abort(index); item = undefined; }
    if (!item) { item = { id: crypto.randomUUID(), name: "", phase, text: "", expression: reply.expression, started: false, ended: false }; this.pending.set(index, item); }
    this.start(item);
    if (reply.text.length > item.text.length) { this.trace?.firstText(); this.emit({ type: "utterance_delta", utteranceId: item.id, text: reply.text.slice(item.text.length) }); }
    item.text = reply.text; item.ended = true;
    this.emit({ type: "utterance_end", utteranceId: item.id, reply }); return item.id;
  }
  abort(index: number) {
    const item = this.pending.get(index);
    if (!item || !item.started || item.ended) return;
    item.ended = true;
    this.emit({ type: "utterance_end", utteranceId: item.id, reply: { text: item.text, expression: item.expression, choices: [] }, interrupted: true });
  }
  abortOpen() { for (const index of this.pending.keys()) this.abort(index); }
}
