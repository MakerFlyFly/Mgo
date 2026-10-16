import { afterEach, describe, expect, it, vi } from "vitest";
import { characterArt, waitingFaces, type CharacterVisual } from "@/lib/character-art";
import { CharacterAssets } from "@/lib/character-assets";
import { characterVisual, shouldWait, WaitingAnimation, type CharacterState } from "@/lib/waiting-animation";
import { expressionValues, newSession, type Expression, type StreamEvent } from "@/lib/domain/types";
import { DialoguePlayback } from "@/lib/dialogue/playback";
import { SpeechCadence } from "@/lib/audio/synth";
import { runAgent } from "@/lib/agent/engine";
import { MockOrderingProvider } from "@/lib/providers/mock";

const waiting: CharacterState = { active: true, busy: true, error: false, handoff: false, speaking: false, finalStarted: false, expression: "happy" };
afterEach(() => vi.useRealTimers());

describe("character presentation priority", () => {
  it("keeps speech, final replies, handoff and errors above waiting variation", () => {
    expect(shouldWait(waiting)).toBe(true);
    expect(characterVisual(waiting, "thinking-focus")).toBe("thinking-focus");
    expect(characterVisual({ ...waiting, speaking: true, expression: "shy" }, "thinking-blink")).toBe("shy");
    expect(characterVisual({ ...waiting, finalStarted: true, expression: "eager" }, "thinking-blink")).toBe("eager");
    expect(characterVisual({ ...waiting, handoff: true, speaking: true }, "thinking-blink")).toBe("handoff");
    expect(characterVisual({ ...waiting, error: true, handoff: true }, "thinking-blink")).toBe("sorry");
    expect(shouldWait({ ...waiting, active: false })).toBe(false);
    expect(characterVisual({ ...waiting, busy: false, expression: "sleepy" })).toBe("sleepy");
  });
  it("falls back for unknown expressions without exposing visual-only IDs to the model", () => {
    expect(characterVisual({ ...waiting, busy: false, expression: "future-value" })).toBe("neutral");
    expect(characterArt("future-value")).toBe("/art/character/v2/neutral.webp");
    expect(characterArt("shy")).toBe("/art/character/v3/shy.webp");
    expect(expressionValues).not.toContain("thinking-blink");
    const player = new DialoguePlayback(); player.start("x", "final", "unknown" as Expression); player.append("x", "你好");
    expect(player.tick()?.expression).toBe("neutral");
  });
});

describe("natural waiting animation", () => {
  it("rotates after 4–7s without immediately repeating the same face", async () => {
    vi.useFakeTimers(); const changes: CharacterVisual[] = [];
    const animation = new WaitingAnimation(face => changes.push(face), () => .5);
    animation.start(waitingFaces); expect(changes).toEqual(["thinking"]);
    await vi.advanceTimersByTimeAsync(5499); expect(changes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); expect(changes[1]).toBe("thinking-ponder");
    await vi.advanceTimersByTimeAsync(5500); expect(changes[2]).toBe("thinking-focus");
    for (let index=1;index<changes.length;index++) expect(changes[index]).not.toBe(changes[index-1]);
    animation.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it("blinks for 120ms and restores the current thinking face", async () => {
    vi.useFakeTimers(); const show=vi.fn(), animation=new WaitingAnimation(show,()=>0);
    animation.start([...waitingFaces,"thinking-blink"]);
    await vi.advanceTimersByTimeAsync(3000); expect(show).toHaveBeenLastCalledWith("thinking-blink");
    await vi.advanceTimersByTimeAsync(119); expect(show).toHaveBeenLastCalledWith("thinking-blink");
    await vi.advanceTimersByTimeAsync(1); expect(show).toHaveBeenLastCalledWith("thinking");
    await vi.advanceTimersByTimeAsync(880); expect(show).toHaveBeenLastCalledWith("thinking-focus"); animation.stop();
  });
  it("cancels pending blink restoration/rotation and restarts without catch-up", async () => {
    vi.useFakeTimers(); const show=vi.fn(),animation=new WaitingAnimation(show,()=>0);
    animation.start([...waitingFaces,"thinking-blink"]); await vi.advanceTimersByTimeAsync(3000);
    animation.stop(); const stopped=show.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000); expect(show).toHaveBeenCalledTimes(stopped);
    animation.start([...waitingFaces,"thinking-blink"]); expect(show).toHaveBeenLastCalledWith("thinking");
    await vi.advanceTimersByTimeAsync(2999); expect(show).toHaveBeenCalledTimes(stopped+1); animation.stop();
  });
  it("uses a static original thinking face for reduced motion and never selects unloaded variants", async () => {
    vi.useFakeTimers(); const show=vi.fn(),animation=new WaitingAnimation(show,()=>0);
    animation.start([...waitingFaces,"thinking-blink"],true);
    await vi.advanceTimersByTimeAsync(20000); expect(show.mock.calls).toEqual([["thinking"]]); expect(vi.getTimerCount()).toBe(0);
    show.mockClear(); animation.start(["thinking"]);
    await vi.advanceTimersByTimeAsync(20000); expect(show.mock.calls.every(([face])=>face==="thinking")).toBe(true); animation.stop();
  });
});

describe("background character resources", () => {
  it("does not expose an image before decode and deduplicates pending requests", async () => {
    let finish!:()=>void; const decode=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const assets=new CharacterAssets(decode), changed=vi.fn(); const unsubscribe=assets.subscribe(changed);
    const first=assets.load("shy"),second=assets.load("shy"); expect(first).toBe(second);
    expect(assets.available("shy")).toBe("neutral"); await Promise.resolve(); expect(decode).toHaveBeenCalledOnce();
    finish(); expect(await first).toBe(true); expect(assets.available("shy")).toBe("shy"); expect(changed).toHaveBeenCalledOnce();
    unsubscribe(); assets.fail("shy"); expect(changed).toHaveBeenCalledOnce();
  });
  it("falls back on failed resources without retry loops or delayed resurrection", async () => {
    const fail=vi.fn(async()=>{throw new Error("404");}),assets=new CharacterAssets(fail);
    expect(await assets.load("shy")).toBe(false); expect(await assets.load("shy")).toBe(false);
    expect(fail).toHaveBeenCalledOnce(); expect(assets.available("shy")).toBe("neutral");
    let finish!:()=>void; const late=new CharacterAssets(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const pending=late.load("thinking-focus"); await Promise.resolve(); late.fail("thinking-focus"); finish();
    expect(await pending).toBe(false); expect(late.available("thinking-focus")).toBe("neutral");
  });
});

describe("new expression contract", () => {
  it.each(["shy","eager","pout","sleepy"] as const)("validates and streams %s while keeping the neutral voice parameters", async expression => {
    const events:StreamEvent[]=[],provider=new MockOrderingProvider(),calls=vi.spyOn(provider,"callTool");
    await runAgent(newSession("demo"),provider,{complete:async()=>({role:"assistant",content:null,tool_calls:[{id:"x",type:"function",function:{name:"reply_to_guest",arguments:JSON.stringify({expression,text:"客人，今天也要好好吃饭。",choices:[]})}}]})},"聊聊",event=>events.push(event));
    expect(events).toContainEqual(expect.objectContaining({type:"utterance_end",reply:expect.objectContaining({expression})}));
    expect(calls).not.toHaveBeenCalled();
    expect(new SpeechCadence().next("你好",0,expression)).toEqual(new SpeechCadence().next("你好",0,"neutral"));
  });
});
