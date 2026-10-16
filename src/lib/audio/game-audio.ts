import type { Expression } from "../domain/types";
import { SpeechCadence, synthesizeVowel, voiceGain } from "./synth";

type ActiveSound = { source: AudioScheduledSourceNode; gain: GainNode; speech: boolean };

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers: AudioBuffer[] = [];
  private sounds = new Set<ActiveSound>();
  private cadence = new SpeechCadence();
  private enabled = true;
  private speechAllowed = false;
  private disposed = false;

  unlock() {
    if (!this.enabled || this.disposed) return;
    try {
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.master = context.createGain(); this.master.gain.value = voiceGain; this.master.connect(context.destination);
        for (let vowel = 0; vowel < 5; vowel++) for (let variant = 0; variant < 3; variant++) {
          const pcm = synthesizeVowel(vowel, variant, context.sampleRate);
          const buffer = context.createBuffer(1, pcm.length, context.sampleRate);
          buffer.copyToChannel(pcm, 0); this.buffers.push(buffer);
        }
      }
      if (this.context.state === "suspended") void this.context.resume().catch(() => {});
    } catch { /* Browsers without audio support remain fully playable. */ }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopAll();
    if (this.context && this.master) {
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(enabled ? voiceGain : 0, now, .003);
    }
  }

  allowSpeech(allowed: boolean) { this.speechAllowed = allowed; if (!allowed) this.stopSpeech(); }

  speakGlyphs(glyphs: string, mood: Expression) {
    const context = this.context;
    if (!this.enabled || !this.speechAllowed || this.disposed || !context || context.state !== "running" || document.hidden) return;
    const syllable = this.cadence.next(glyphs, context.currentTime, mood);
    if (!syllable || [...this.sounds].filter(sound => sound.speech).length >= 2) return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = this.buffers[syllable.vowel * 3 + syllable.variant];
    source.playbackRate.value = syllable.rate; gain.gain.value = syllable.gain;
    this.track(source, gain, true); source.start();
  }

  tap() {
    const context = this.context;
    if (!this.enabled || this.disposed || !context || context.state !== "running" || document.hidden || this.sounds.size) return;
    const source = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
    source.type = "sine"; source.frequency.setValueAtTime(1000, now); source.frequency.exponentialRampToValueAtTime(760, now + .03);
    gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(.12, now + .003); gain.gain.linearRampToValueAtTime(0, now + .035);
    this.track(source, gain, false); source.start(); source.stop(now + .04);
  }

  private track(source: AudioScheduledSourceNode, gain: GainNode, speech: boolean) {
    const sound = { source, gain, speech };
    source.connect(gain); gain.connect(this.master!); this.sounds.add(sound);
    source.onended = () => { this.sounds.delete(sound); source.disconnect(); gain.disconnect(); };
  }

  private stop(sound: ActiveSound) {
    const now = this.context?.currentTime || 0;
    try {
      sound.gain.gain.cancelScheduledValues(now); sound.gain.gain.setTargetAtTime(0, now, .003);
      sound.source.stop(now + .012);
    } catch { /* A source may already have ended. */ }
    this.sounds.delete(sound);
  }

  stopSpeech() { this.cadence.reset(); for (const sound of this.sounds) if (sound.speech) this.stop(sound); }
  private stopAll() { this.cadence.reset(); for (const sound of this.sounds) this.stop(sound); }

  suspend() { this.stopAll(); if (this.context?.state === "running") void this.context.suspend().catch(() => {}); }
  resumeExisting() { if (this.enabled && this.context?.state === "suspended") void this.context.resume().catch(() => {}); }

  dispose() {
    this.disposed = true; this.stopAll();
    const context = this.context; this.context = null; this.master = null; this.buffers = [];
    if (context && context.state !== "closed") void context.close().catch(() => {});
  }
}
