import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechCadence, synthesizeVowel, syllableInterval } from "@/lib/audio/synth";
import { GameAudio } from "@/lib/audio/game-audio";

class Param {
  value = 0;
  cancelScheduledValues = vi.fn(); setTargetAtTime = vi.fn(); setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn(); linearRampToValueAtTime = vi.fn();
}
class Source {
  buffer: unknown; playbackRate = new Param(); frequency = new Param(); type = "sine";
  onended: (() => void) | null = null;
  connect = vi.fn(); disconnect = vi.fn(); start = vi.fn(); stop = vi.fn();
}
class AudioContextStub {
  static instances: AudioContextStub[] = [];
  currentTime = 0; sampleRate = 48000; state = "suspended"; destination = {};
  sources: Source[] = [];
  constructor() { AudioContextStub.instances.push(this); }
  createGain() { return { gain: new Param(), connect: vi.fn(), disconnect: vi.fn() }; }
  createBuffer = vi.fn(() => ({ copyToChannel: vi.fn() }));
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  createOscillator() { const source = new Source(); this.sources.push(source); return source; }
  resume = vi.fn(async () => { this.state = "running"; });
  suspend = vi.fn(async () => { this.state = "suspended"; });
  close = vi.fn(async () => { this.state = "closed"; });
}
function engine() {
  AudioContextStub.instances = [];
  vi.stubGlobal("AudioContext", AudioContextStub); vi.stubGlobal("document", { hidden: false });
  const audio = new GameAudio(); audio.unlock(); audio.allowSpeech(true);
  return { audio, context: AudioContextStub.instances[0] };
}
afterEach(() => vi.unstubAllGlobals());

describe("typewriter speech", () => {
  it("stays silent for punctuation and bounds syllable rate without repeated vowels", () => {
    const cadence = new SpeechCadence(), events = [];
    expect(cadence.next(" ，。…！\n", 0, "happy")).toBeUndefined();
    for (let step = 0; step < 400; step++) {
      const time = .2 + step * .005, syllable = cadence.next("欢迎", time, "happy");
      if (syllable) events.push({ time, ...syllable });
    }
    expect(events.length).toBeGreaterThan(10);
    for (let index = 1; index < events.length; index++) {
      expect(events[index].time - events[index - 1].time + .000001).toBeGreaterThanOrEqual(syllableInterval);
      expect(events[index].vowel).not.toBe(events[index - 1].vowel);
    }
  });
  it("generates bounded finite PCM with silent edges for each vowel and variant", () => {
    for (let vowel = 0; vowel < 5; vowel++) for (let variant = 0; variant < 3; variant++) {
      const pcm = synthesizeVowel(vowel, variant, 48000);
      expect(pcm.length / 48000).toBeGreaterThanOrEqual(.05);
      expect(pcm.length / 48000).toBeLessThanOrEqual(.09);
      expect(pcm[0]).toBe(0); expect(pcm.at(-1)).toBe(0);
      expect(pcm.every(value => Number.isFinite(value) && Math.abs(value) < .73)).toBe(true);
    }
  });
  it("reuses one context, limits concurrent sources and never queues skipped glyphs", () => {
    const { audio, context } = engine(); audio.unlock();
    expect(AudioContextStub.instances).toHaveLength(1); expect(context.createBuffer).toHaveBeenCalledTimes(15);
    audio.speakGlyphs("欢迎", "happy"); context.currentTime = .1; audio.speakGlyphs("客人", "happy");
    context.currentTime = .2; audio.speakGlyphs("菜单", "happy");
    expect(context.sources).toHaveLength(2);
    context.sources.forEach(source => source.onended?.());
    expect(context.sources).toHaveLength(2);
    context.currentTime = .4; audio.speakGlyphs("你好", "happy"); expect(context.sources).toHaveLength(3);
    audio.stopSpeech(); expect(context.sources.at(-1)?.stop).toHaveBeenCalledOnce();
    audio.dispose(); expect(context.close).toHaveBeenCalledOnce();
  });
  it("stops on mute and background, resumes only new glyphs, and disposes safely", () => {
    const { audio, context } = engine(); audio.speakGlyphs("欢迎", "happy");
    audio.setEnabled(false); expect(context.sources[0].stop).toHaveBeenCalledOnce();
    context.currentTime = 1; audio.speakGlyphs("不会补播", "neutral"); expect(context.sources).toHaveLength(1);
    audio.setEnabled(true); expect(context.sources).toHaveLength(1);
    audio.speakGlyphs("新字", "neutral"); expect(context.sources).toHaveLength(2);
    audio.suspend(); expect(context.sources[1].stop).toHaveBeenCalledOnce();
    context.currentTime = 2; audio.speakGlyphs("后台", "neutral"); expect(context.sources).toHaveLength(2);
    audio.resumeExisting(); expect(context.sources).toHaveLength(2);
    vi.stubGlobal("document", { hidden: true }); audio.speakGlyphs("隐藏", "neutral"); expect(context.sources).toHaveLength(2);
    audio.dispose(); audio.unlock(); expect(AudioContextStub.instances).toHaveLength(1);
  });
  it("keeps operating when browser audio is unavailable", () => {
    vi.stubGlobal("AudioContext", class { constructor() { throw new Error("Unavailable"); } });
    const audio = new GameAudio();
    expect(() => { audio.unlock(); audio.allowSpeech(true); audio.speakGlyphs("你好", "happy"); audio.tap(); audio.suspend(); audio.dispose(); }).not.toThrow();
  });
});
