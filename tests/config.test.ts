import { describe, expect, it, vi, afterEach } from "vitest";
import { configuration, publicConfiguration } from "@/lib/server/config";
import { chatRequestSchema, demoSessionSchema } from "@/lib/server/validation";
import { newSession } from "@/lib/domain/types";
import { checkOrigin } from "@/lib/server/http";
afterEach(() => vi.unstubAllEnvs());
describe("public and personal boundaries", () => {
  it("does not expose credentials and forces Vercel to demo mode", () => {
    vi.stubEnv("APP_MODE", "live"); vi.stubEnv("VERCEL", "1"); vi.stubEnv("DEEPSEEK_API_KEY", "private-test-key"); vi.stubEnv("MCD_MCP_TOKEN", "private-test-token");
    expect(configuration().mode).toBe("demo"); expect(publicConfiguration().requiresVisitorKey).toBe(true);
    expect(JSON.stringify(publicConfiguration())).not.toContain("private-test");
  });
  it("rejects forged live state in public demo payloads", () => {
    const session = newSession("live"); expect(demoSessionSchema.safeParse(session).success).toBe(false);
    expect(chatRequestSchema.safeParse({ requestId: crypto.randomUUID(), message: "hello", apiKey: "not-saved", demoState: newSession("demo") }).success).toBe(true);
  });
  it("rejects cross-origin actions and sensitive preference fields", () => {
    expect(() => checkOrigin(new Request("http://localhost:3000/api/chat", { headers: { origin: "https://elsewhere.example" } }))).toThrow();
    expect(chatRequestSchema.safeParse({ requestId: crypto.randomUUID(), message: "hi", preferences: { tastes: [], phone: "13800000000" } }).success).toBe(false);
  });
  it("accepts the actual browser host when Next reconstructs an internal localhost URL", () => {
    expect(() => checkOrigin(new Request("http://localhost:3118/api/chat", { headers: { host: "127.0.0.1:3118", origin: "http://127.0.0.1:3118", "sec-fetch-site": "same-origin" } }))).not.toThrow();
  });
});
