import type { Expression } from "../domain/types";

// Original vowel-like tones. No recorded speech or game samples are used.
const vowels = [
  [700, 1250, 2600], [450, 1850, 2700], [300, 2250, 3000],
  [500, 900, 2450], [350, 1050, 2350],
] as const;
const moods: Record<Expression, { pitch: number; gain: number }> = {
  neutral: { pitch: 1, gain: .94 }, happy: { pitch: 1.055, gain: 1 },
  thinking: { pitch: .97, gain: .85 }, smug: { pitch: 1.02, gain: .94 },
  surprised: { pitch: 1.09, gain: .98 }, sorry: { pitch: .95, gain: .78 },
  shy: { pitch: 1, gain: .94 }, eager: { pitch: 1, gain: .94 },
  pout: { pitch: 1, gain: .94 }, sleepy: { pitch: 1, gain: .94 },
};
export const voiceGain = .09;
export const speechProfile = { version: "light-girl-v5", basePitchHz: 930, formantScale: 1.6 } as const;
export const syllableInterval = 1 / 12;
export type Syllable = { vowel: number; variant: number; rate: number; gain: number };

export function synthesizeVowel(vowel: number, variant: number, sampleRate: number): Float32Array<ArrayBuffer> {
  const formants = vowels[vowel % vowels.length].map(value => value * speechProfile.formantScale);
  const frequency = speechProfile.basePitchHz + (variant % 3 - 1) * 13;
  const duration = .06 + variant % 3 * .01;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  const weights = Array.from({ length: 13 }, (_, index) => {
    const harmonic = index + 1, hz = harmonic * frequency;
    const resonance = formants.reduce((sum, center, band) => sum + Math.exp(-.5 * ((hz - center) / [150, 230, 320][band]) ** 2) * [1, .68, .22][band], 0);
    const thinTone = harmonic === 1 ? .16 : harmonic === 2 ? 1 : .7;
    return (.015 + resonance) / Math.sqrt(harmonic) * thinTone * Math.exp(-Math.max(0, hz - 5000) / 1900);
  });
  let peak = 0, noise = 173 + vowel * 31 + variant * 97;
  for (let index = 0; index < samples.length; index++) {
    const t = index / sampleRate, progress = index / (samples.length - 1);
    const phase = 2 * Math.PI * frequency * (t + .00006 * Math.sin(2 * Math.PI * 6 * t));
    let value = 0;
    for (let harmonic = 1; harmonic <= weights.length; harmonic++) {
      value += Math.sin(phase * harmonic + Math.sin(progress * Math.PI) * .04 * harmonic) * weights[harmonic - 1];
    }
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
    value += (noise / 4294967296 - .5) * .004;
    const attack = Math.min(1, t / .006), release = Math.min(1, (duration - t) / .02);
    const envelope = Math.sin(attack * Math.PI / 2) ** 2 * Math.sin(Math.max(0, release) * Math.PI / 2) ** 2;
    samples[index] = value * envelope;
    peak = Math.max(peak, Math.abs(samples[index]));
  }
  const scale = peak ? .72 / peak : 0;
  for (let index = 0; index < samples.length; index++) samples[index] *= scale;
  samples[0] = 0; samples[samples.length - 1] = 0;
  return samples;
}

export class SpeechCadence {
  private nextAt = 0;
  private previousVowel = -1;
  private ordinal = 0;

  reset() { this.nextAt = 0; this.previousVowel = -1; this.ordinal = 0; }

  next(glyphs: string, time: number, mood: Expression): Syllable | undefined {
    let syllable: Syllable | undefined;
    for (const glyph of Array.from(glyphs)) {
      if (/[。！？.!?]/u.test(glyph)) { this.nextAt = Math.max(this.nextAt, time + .06); continue; }
      if (/[，、；：,;:…]/u.test(glyph)) { this.nextAt = Math.max(this.nextAt, time + .03); continue; }
      if (syllable || time + .000001 < this.nextAt || !/[\p{L}\p{N}]/u.test(glyph)) continue;
      let vowel = ((glyph.codePointAt(0) || 0) + this.ordinal * 3) % vowels.length;
      if (vowel === this.previousVowel) vowel = (vowel + 1) % vowels.length;
      const character = moods[mood] || moods.neutral;
      syllable = { vowel, variant: this.ordinal % 3, rate: character.pitch * (1 + (this.ordinal * 7 % 11 - 5) * .004), gain: character.gain };
      this.previousVowel = vowel; this.ordinal++; this.nextAt = time + syllableInterval;
    }
    return syllable;
  }
}
