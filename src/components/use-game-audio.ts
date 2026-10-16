"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Expression } from "@/lib/domain/types";
import { GameAudio } from "@/lib/audio/game-audio";

const preferenceKey = "mgo.sound.v1";

export function useGameAudio() {
  const [enabled, setEnabled] = useState(true);
  const enabledRef = useRef(true), speechAllowed = useRef(false), engine = useRef<GameAudio | null>(null);
  const getEngine = useCallback(() => {
    if (!engine.current) {
      engine.current = new GameAudio(); engine.current.setEnabled(enabledRef.current); engine.current.allowSpeech(speechAllowed.current);
    }
    return engine.current;
  }, []);
  const unlock = useCallback(() => { if (enabledRef.current) getEngine().unlock(); }, [getEngine]);
  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next; setEnabled(next);
    try { sessionStorage.setItem(preferenceKey, next ? "on" : "off"); } catch { /* optional tab preference */ }
    getEngine().setEnabled(next); if (next) getEngine().unlock();
  }, [getEngine]);
  const allowSpeech = useCallback((allowed: boolean) => { speechAllowed.current = allowed; engine.current?.allowSpeech(allowed); }, []);
  const speakGlyphs = useCallback((glyphs: string, mood: Expression) => engine.current?.speakGlyphs(glyphs, mood), []);
  const stopSpeech = useCallback(() => engine.current?.stopSpeech(), []);
  const tap = useCallback(() => engine.current?.tap(), []);
  const tryResume = useCallback(() => { if (enabledRef.current && navigator.userActivation?.hasBeenActive) getEngine().unlock(); }, [getEngine]);

  useEffect(() => {
    let restored = true;
    try { restored = sessionStorage.getItem(preferenceKey) !== "off"; } catch {}
    enabledRef.current = restored; setEnabled(restored); engine.current?.setEnabled(restored);
    const visibility = () => { if (document.hidden) engine.current?.suspend(); else engine.current?.resumeExisting(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); engine.current?.dispose(); engine.current = null; };
  }, []);
  return { enabled, unlock, toggle, allowSpeech, speakGlyphs, stopSpeech, tap, tryResume };
}
