// Handles arbitrary UTF-8 / CRLF boundaries, comments, and multi-line data fields.
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader(), decoder = new TextDecoder();
  let pending = "", data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, ""); pending = pending.slice(newline + 1);
        if (!line) { if (data.length) { yield data.join("\n"); data = []; } }
        else if (line === "data") data.push("");
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (pending.length > 2_000_000) throw new Error("SSE frame too large");
      if (done) break;
    }
    if (pending.startsWith("data:")) data.push(pending.slice(5).replace(/^ /, "").replace(/\r$/, ""));
    if (data.length) yield data.join("\n");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
