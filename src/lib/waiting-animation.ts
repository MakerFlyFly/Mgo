import { waitingFaces, type CharacterVisual, type WaitingFace } from "./character-art";
import { normalizeExpression } from "./domain/types";

export interface CharacterState {
  active: boolean; busy: boolean; error: boolean; handoff: boolean;
  speaking: boolean; finalStarted: boolean; expression: unknown;
}
export function shouldWait(state: CharacterState) {
  return state.active && state.busy && !state.error && !state.handoff && !state.speaking && !state.finalStarted;
}
export function characterVisual(state: CharacterState, waitingFace: CharacterVisual = "thinking"): CharacterVisual {
  if (state.error) return "sorry";
  if (state.handoff) return "handoff";
  return shouldWait(state) ? waitingFace : normalizeExpression(state.expression);
}

export class WaitingAnimation {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private generation = 0;
  private base: WaitingFace = "thinking";
  constructor(private show: (visual: CharacterVisual) => void, private random: () => number = Math.random) {}
  stop() { this.generation++; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
  start(ready: readonly CharacterVisual[], reducedMotion = false) {
    this.stop(); const generation = this.generation;
    const candidates = waitingFaces.filter(face => ready.includes(face));
    this.base = reducedMotion ? "thinking" : candidates.includes("thinking") ? "thinking" : candidates[0] || "thinking";
    this.show(this.base); if (reducedMotion) return;
    const later = (delay: number, run: () => void) => {
      const timer = setTimeout(() => { this.timers.delete(timer); if (this.generation === generation) run(); }, delay);
      this.timers.add(timer);
    };
    let blinking = false;
    const rotate = () => later(4000 + this.random() * 3000, () => {
      const alternatives = candidates.filter(face => face !== this.base);
      if (alternatives.length) this.base = alternatives[Math.min(alternatives.length - 1, Math.floor(this.random() * alternatives.length))];
      if (!blinking) this.show(this.base); rotate();
    });
    const blink = () => later(3000 + this.random() * 2000, () => {
      blinking = true; this.show("thinking-blink");
      later(120, () => { blinking = false; this.show(this.base); blink(); });
    });
    rotate(); if (ready.includes("thinking-blink")) blink();
  }
}
