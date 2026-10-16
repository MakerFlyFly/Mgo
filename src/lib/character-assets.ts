import { characterArt, type CharacterVisual } from "./character-art";

export function decodeCharacterImage(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => finish(new Error("Character image timed out")), 15000);
    const finish = (error?: Error) => { clearTimeout(timer); image.onload = null; image.onerror = null; if (error) reject(error); else resolve(); };
    image.onload = () => { void image.decode().then(() => finish(), () => finish(new Error("Character image could not be decoded"))); };
    image.onerror = () => finish(new Error("Character image failed")); image.src = source;
  });
}

export class CharacterAssets {
  private ready = new Set<CharacterVisual>(["happy", "neutral"]);
  private failed = new Set<CharacterVisual>();
  private pending = new Map<CharacterVisual, Promise<boolean>>();
  private listeners = new Set<() => void>();
  constructor(private decode: (source: string) => Promise<void> = decodeCharacterImage) {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  isReady(visual: CharacterVisual) { return this.ready.has(visual); }
  fail(visual: CharacterVisual) { this.ready.delete(visual); this.failed.add(visual); this.changed(); }
  load(visual: CharacterVisual): Promise<boolean> {
    if (this.ready.has(visual)) return Promise.resolve(true);
    if (this.failed.has(visual)) return Promise.resolve(false);
    const pending = this.pending.get(visual); if (pending) return pending;
    const next = Promise.resolve().then(() => this.decode(characterArt(visual))).then(() => { if (this.failed.has(visual)) return false; this.ready.add(visual); this.changed(); return true; }, () => { this.fail(visual); return false; }).finally(() => this.pending.delete(visual));
    this.pending.set(visual, next); return next;
  }
  available(visual: CharacterVisual): CharacterVisual {
    if (this.ready.has(visual)) return visual;
    if (visual.startsWith("thinking") && this.ready.has("thinking")) return "thinking";
    if (this.ready.has("neutral")) return "neutral";
    return "happy";
  }
}
