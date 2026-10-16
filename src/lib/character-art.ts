import { normalizeExpression, type Expression } from "./domain/types";

export const extraCharacterVisuals = ["shy", "eager", "pout", "sleepy", "thinking-focus", "thinking-ponder", "thinking-blink"] as const;
export const waitingFaces = ["thinking", "thinking-focus", "thinking-ponder"] as const;
export type WaitingFace = typeof waitingFaces[number];
export type CharacterVisual = Expression | "handoff" | typeof extraCharacterVisuals[number];

// Keep the repaired v2 artwork; only new faces use v3 URLs.
export function characterArt(visual: unknown) {
  if (typeof visual === "string" && (extraCharacterVisuals as readonly string[]).includes(visual)) return `/art/character/v3/${visual}.webp`;
  return `/art/character/v2/${visual === "handoff" ? visual : normalizeExpression(visual)}.webp`;
}
