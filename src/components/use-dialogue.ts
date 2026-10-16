"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentReply, Expression, StreamEvent } from "@/lib/domain/types";
import { normalizeExpression } from "@/lib/domain/types";
import { DialoguePlayback, type DialogueLine } from "@/lib/dialogue/playback";

type Voice = { speakGlyphs(glyphs: string, expression: Expression): void; stopSpeech(): void };
export function useDialogue(active: boolean, voice: Voice) {
  const playback = useRef(new DialoguePlayback()), recorded = useRef(new Set<string>());
  const [lines, setLines] = useState<DialogueLine[]>([]), [expression, setExpression] = useState<Expression>("happy");
  const publish = useCallback(() => setLines(playback.current.snapshot()), []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const tick = playback.current.tick();
      if (tick) { publish(); setExpression(tick.expression); if (tick.glyphs) voice.speakGlyphs(tick.glyphs, tick.expression); }
    }, 25);
    return () => { clearInterval(timer); voice.stopSpeech(); };
  }, [active, publish, voice.speakGlyphs, voice.stopSpeech]);
  const beginTurn = useCallback(() => { voice.stopSpeech(); playback.current.reset(); publish(); }, [publish, voice.stopSpeech]);
  const replace = useCallback((reply: AgentReply) => {
    beginTurn(); const id = crypto.randomUUID(); playback.current.start(id, "final", reply.expression); playback.current.finish(id, reply); setExpression(normalizeExpression(reply.expression)); publish();
  }, [beginTurn, publish]);
  const skipReceived = useCallback(() => { voice.stopSpeech(); playback.current.skipReceived(); publish(); }, [publish, voice.stopSpeech]);
  const interrupt = useCallback(() => { voice.stopSpeech(); playback.current.interrupt(); publish(); }, [publish, voice.stopSpeech]);
  const receive = useCallback((event: StreamEvent): { record?: string; reply?: AgentReply } => {
    const player = playback.current;
    if (event.type === "utterance_start") {
      if (!player.buffered() && !player.snapshot().some(line => !line.complete)) setExpression(normalizeExpression(event.expression));
      player.start(event.utteranceId, event.phase, event.expression); publish();
    }
    if (event.type === "utterance_delta") player.append(event.utteranceId, event.text);
    if (event.type !== "utterance_end" && event.type !== "reply") return {};
    const reply = { ...event.reply, expression: normalizeExpression(event.reply.expression) };
    const id = event.utteranceId || crypto.randomUUID();
    const interrupted = event.type === "utterance_end" && event.interrupted;
    if (!player.has(id)) player.start(id, "final", reply.expression);
    if (interrupted) { player.interrupt(id); voice.stopSpeech(); } else player.finish(id, reply);
    publish();
    const line = player.snapshot().find(line => line.id === id);
    if (!interrupted && player.snapshot().filter(line => line.text).at(-1)?.id === id) setExpression(reply.expression);
    const record = !recorded.current.has(id) ? interrupted ? line?.text ? `${line.text}\n（回应中断）` : undefined : event.reply.text : undefined;
    recorded.current.add(id);
    const final = event.type === "reply" || line?.phase === "final";
    return { record, ...(!interrupted && final ? { reply } : {}) };
  }, [publish, voice.stopSpeech]);
  const speaking = lines.some(line => !line.complete) || playback.current.buffered();
  const finalStarted = lines.some(line => line.phase === "final");
  return { lines, expression, speaking, finalStarted, beginTurn, replace, skipReceived, interrupt, receive, buffered: () => playback.current.buffered(), empty: () => playback.current.empty() };
}
