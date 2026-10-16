import { mkdir, writeFile } from "node:fs/promises";
import { SpeechCadence, synthesizeVowel, voiceGain, syllableInterval, speechProfile } from "../src/lib/audio/synth.ts";

const sampleRate = 48000, duration = 6;
const output = new Float32Array(sampleRate * duration);
const lines = [
  { at: .08, mood: "happy", text: "欢迎光临云麦当劳～今天想吃点什么，客人？我刚好……咳，正在认真值班。点餐、挑优惠，或者先聊两句，都可以找我。" },
  { at: 2, mood: "thinking", text: "客人慢慢挑就好。我来看看今天的菜单，再核对一下价格。点单夹、优惠券，还有……我的午饭。咳，前两样已经准备好了。" },
  { at: 4, mood: "sorry", text: "嗯？客人需要什么？我只是稍微摆了一下尾巴，可没有在摸鱼哦。今天也要好好吃饭，鲸鱼娘会认真记单的，客人放心。" },
];
const events = [];
for (const line of lines) {
  const cadence = new SpeechCadence(), glyphs = Array.from(line.text);
  for (let index = 0; index < glyphs.length; index += 2) {
    const at = line.at + index / 2 * .025;
    const syllable = cadence.next(glyphs.slice(index, index + 2).join(""), at, line.mood);
    if (!syllable) continue;
    events.push({ at, ...syllable, mood: line.mood });
    const samples = synthesizeVowel(syllable.vowel, syllable.variant, sampleRate);
    const start = Math.round(at * sampleRate), length = Math.ceil(samples.length / syllable.rate);
    for (let offset = 0; offset < length && start + offset < output.length; offset++) {
      const cursor = offset * syllable.rate, left = Math.floor(cursor), fraction = cursor - left;
      const value = (samples[left] || 0) * (1 - fraction) + (samples[left + 1] || 0) * fraction;
      output[start + offset] += value * syllable.gain * voiceGain;
    }
  }
}
let peak = 0, energy = 0, clippedSamples = 0, minimumGap = Infinity;
for (const value of output) { peak = Math.max(peak, Math.abs(value)); energy += value * value; if (Math.abs(value) >= 1) clippedSamples++; }
for (let index = 1; index < events.length; index++) minimumGap = Math.min(minimumGap, events[index].at - events[index - 1].at);
if (clippedSamples || !Number.isFinite(peak) || peak < .02 || minimumGap + .000001 < syllableInterval) throw new Error("Speech preview failed audio bounds");
const wav = Buffer.alloc(44 + output.length * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(output.length * 2, 40);
for (let index = 0; index < output.length; index++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, output[index])) * 32767), 44 + index * 2);
await mkdir("docs/audio", { recursive: true });
await writeFile("docs/audio/whale-speech-preview.wav", wav);
await writeFile(`docs/audio/whale-speech-preview-${speechProfile.version.split("-").at(-1)}.wav`, wav);
const report = { duration, sampleRate, channels: 1, ...speechProfile, syllables: events.length, peak: Number(peak.toFixed(6)), rms: Number(Math.sqrt(energy / output.length).toFixed(6)), clippedSamples, minimumGap: Number(minimumGap.toFixed(3)), source: "Original synthesized vowels; same DSP, cadence and gain as the game", lines };
await writeFile("docs/audio/preview-report.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, lines: report.lines.length }));
