// Only bounded identifiers and timings are retained. No prompts, arguments or credentials.
export class AgentTrace {
  private started = performance.now();
  private firstTextMs: number | null = null;
  private models: number[] = [];
  private initialization: number[] = [];
  private tools: { name: string; ms: number }[] = [];
  private reported = false;
  constructor(private requestId: string, private mode: "demo" | "live") {}
  firstText() { this.firstTextMs ??= Math.round(performance.now() - this.started); }
  async model<T>(run: () => Promise<T>): Promise<T> {
    const start = performance.now(); try { return await run(); } finally { this.models.push(Math.round(performance.now() - start)); }
  }
  async mcp<T>(run: () => Promise<T>): Promise<T> {
    const start = performance.now(); try { return await run(); } finally { this.initialization.push(Math.round(performance.now() - start)); }
  }
  tool(name: string, started: number) { this.tools.push({ name, ms: Math.round(performance.now() - started) }); }
  report() {
    if (this.reported) return; this.reported = true;
    console.info(JSON.stringify({ type: "mgo_timing", requestId: this.requestId, mode: this.mode, firstTextMs: this.firstTextMs, modelRequests: this.models.length, modelMs: this.models, mcpInitMs: this.initialization, tools: this.tools, totalMs: Math.round(performance.now() - this.started) }));
  }
}
