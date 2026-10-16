import type { AgentReply, Expression } from "../domain/types";
import { normalizeExpression } from "../domain/types";

export type DialogueLine = { id: string; phase: "progress" | "final"; text: string; expression: Expression; complete: boolean; interrupted: boolean };
type BufferedLine = Omit<DialogueLine, "text"> & { chars: string[]; shown: number };
export function stageParts(text: string): { text: string; action: boolean }[] {
  const parts: { text: string; action: boolean }[] = []; let depth = 0;
  for (const glyph of Array.from(text)) {
    if (glyph === "（") depth++;
    const action = depth > 0 || glyph === "）";
    const last = parts.at(-1);
    if (last?.action === action) last.text += glyph; else parts.push({ text: glyph, action });
    if (glyph === "）") depth = Math.max(0, depth - 1);
  }
  return parts;
}
export function spokenSlice(chars: string[], from: number, to: number) {
  let depth = 0, result = "";
  for (let index = 0; index < Math.min(to, chars.length); index++) {
    const glyph = chars[index]; if (glyph === "（") depth++;
    if (index >= from && !depth && glyph !== "）") result += glyph;
    if (glyph === "）") depth = Math.max(0, depth - 1);
  }
  return result;
}
export class DialoguePlayback {
  private lines: BufferedLine[] = [];
  has(id: string) { return this.lines.some(line => line.id === id); }
  empty() { return this.lines.length === 0; }
  reset() { this.lines = []; }
  start(id: string, phase: "progress" | "final", expression: Expression) {
    if (!this.has(id)) this.lines.push({ id, phase, expression: normalizeExpression(expression), chars: [], shown: 0, complete: false, interrupted: false });
  }
  append(id: string, text: string) { const line = this.lines.find(line => line.id === id); if (line && !line.complete) line.chars.push(...Array.from(text)); }
  finish(id: string, reply: AgentReply) {
    const line = this.lines.find(line => line.id === id); if (!line || line.complete) return;
    line.chars = Array.from(reply.text); line.expression = normalizeExpression(reply.expression); line.complete = true;
    line.shown = Math.min(line.shown, line.chars.length);
  }
  interrupt(id?: string) {
    for (const line of this.lines) if (!id || line.id === id) {
      if (!line.complete) line.interrupted = true;
      line.chars = line.chars.slice(0, line.shown); line.complete = true;
    }
  }
  skipReceived() { for (const line of this.lines) line.shown = line.chars.length; }
  buffered() { return this.lines.some(line => line.shown < line.chars.length); }
  tick(count = 2): { glyphs: string; expression: Expression } | undefined {
    for (const line of this.lines) {
      if (line.shown < line.chars.length) {
        const from = line.shown; line.shown = Math.min(line.chars.length, from + count);
        return { glyphs: spokenSlice(line.chars, from, line.shown), expression: line.expression };
      }
      // Preserve order when one utterance is still arriving from the model.
      if (!line.complete) return;
    }
  }
  snapshot(): DialogueLine[] { return this.lines.map(({ chars, shown, ...line }) => ({ ...line, text: chars.slice(0, shown).join("") })); }
}
