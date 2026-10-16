// Decode only a top-level string field. Never renders raw JSON or nested tool data.
function stringPrefix(source: string, start: number): { value: string; end: number; complete: boolean } {
  let value = "", index = start + 1;
  for (; index < source.length; index++) {
    const char = source[index];
    if (char === '"') return { value, end: index + 1, complete: true };
    if (char.charCodeAt(0) < 32) throw new Error("Invalid JSON string");
    if (char !== "\\") { value += char; continue; }
    const escape = source[++index]; if (!escape) break;
    if (escape === "u") {
      const hex = source.slice(index + 1, index + 5);
      if (!/^[\da-f]{0,4}$/i.test(hex)) throw new Error("Invalid Unicode escape");
      if (hex.length < 4) break;
      value += String.fromCharCode(parseInt(hex, 16)); index += 4;
    } else {
      const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
      if (!(escape in escapes)) throw new Error("Invalid JSON escape");
      value += escapes[escape];
    }
  }
  // A surrogate pair may span API chunks; withhold the incomplete first half.
  if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return { value, end: index, complete: false };
}
export function topLevelStringPrefix(source: string, field: string): string | undefined {
  let depth = 0;
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (char === "{" || char === "[") { depth++; index++; continue; }
    if (char === "}" || char === "]") { depth--; index++; continue; }
    if (char !== '"') { index++; continue; }
    const key = stringPrefix(source, index); if (!key.complete) return;
    index = key.end;
    if (depth !== 1) continue;
    let cursor = index; while (/\s/.test(source[cursor] || "") && cursor < source.length) cursor++;
    if (source[cursor] !== ":" || key.value !== field) continue;
    cursor++; while (/\s/.test(source[cursor] || "") && cursor < source.length) cursor++;
    if (source[cursor] !== '"') return;
    return stringPrefix(source, cursor).value;
  }
}
