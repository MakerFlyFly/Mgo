import type { Expression } from "./domain/types";

// Versioned paths bypass the browser cache of the original hand artwork.
export function characterArt(expression: Expression | "handoff") {
  return `/art/character/v2/${expression}.webp`;
}
