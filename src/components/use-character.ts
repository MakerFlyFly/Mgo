"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CharacterAssets } from "@/lib/character-assets";
import { extraCharacterVisuals, waitingFaces, type CharacterVisual } from "@/lib/character-art";
import { characterVisual, shouldWait, WaitingAnimation, type CharacterState } from "@/lib/waiting-animation";

const backgroundVisuals: readonly CharacterVisual[] = ["thinking", ...extraCharacterVisuals.filter(id => id.startsWith("thinking")), ...extraCharacterVisuals.filter(id => !id.startsWith("thinking")), "smug", "surprised", "sorry", "handoff"];

export function useCharacter(state: CharacterState, reducedMotion: boolean, turnId: string) {
  const [assets] = useState(() => new CharacterAssets());
  const [, setVersion] = useState(0), [visible, setVisible] = useState(true);
  const [waitingFace, setWaitingFace] = useState<CharacterVisual>("thinking");
  const animator = useRef<WaitingAnimation | null>(null);
  if (!animator.current) animator.current = new WaitingAnimation(setWaitingFace);
  const waiting = shouldWait(state);
  const readyKey = [...waitingFaces, "thinking-blink" as const].filter(face => assets.isReady(face)).join("|");
  useEffect(() => assets.subscribe(() => setVersion(value => value + 1)), [assets]);
  useEffect(() => {
    const update = () => { animator.current?.stop(); setWaitingFace("thinking"); setVisible(!document.hidden); };
    update(); document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); animator.current?.stop(); };
  }, []);
  useEffect(() => {
    if (waiting && visible) animator.current!.start(readyKey.split("|").filter(Boolean) as CharacterVisual[], reducedMotion);
    else { animator.current!.stop(); setWaitingFace("thinking"); }
    return () => animator.current!.stop();
  }, [waiting, visible, readyKey, reducedMotion, turnId]);

  const desired = characterVisual(state, reducedMotion ? "thinking" : waitingFace);
  useEffect(() => { if (state.active && visible) void assets.load(desired); }, [assets, desired, state.active, visible]);
  // One background image at a time; chat and visible speech never await this work.
  useEffect(() => {
    if (!state.active || state.busy || state.speaking || !visible) return;
    let alive = true;
    const timer = setTimeout(() => { void (async () => {
      for (const visual of backgroundVisuals) { if (!alive) break; await assets.load(visual); }
    })(); }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [assets, state.active, state.busy, state.speaking, visible]);
  // Decoded resources notify React; the currently displayed image stays available.
  const visual = assets.available(desired);
  const onError = useCallback(() => assets.fail(visual), [assets, visual]);
  return { visual, onError };
}
