import type { AppMode } from "../domain/types";
import { MgoError } from "../domain/errors";

export function configuration() {
  const configuredMode = process.env.APP_MODE || "demo";
  if (configuredMode !== "demo" && configuredMode !== "live") throw new MgoError("CONFIGURATION", "APP_MODE 只能为 demo 或 live。", 503);
  // A Vercel deployment can never expose the personal account or live SQLite adapter.
  const mode: AppMode = process.env.VERCEL ? "demo" : configuredMode;
  return {
    mode,
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    deepseekKey: process.env.DEEPSEEK_API_KEY || "",
    mcdToken: process.env.MCD_MCP_TOKEN || "",
    dataDir: process.env.MGO_DATA_DIR || ".data",
  };
}
export function publicConfiguration() {
  const config = configuration();
  return {
    mode: config.mode, model: config.model,
    deepseekConfigured: config.mode === "live" && !!config.deepseekKey,
    mcdConfigured: config.mode === "live" && !!config.mcdToken,
    requiresVisitorKey: config.mode === "demo",
  };
}
