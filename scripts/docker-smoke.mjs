import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
const image = process.argv[2] || "mgo:mvp";
const suffix = crypto.randomUUID().slice(0, 8), name = `mgo-smoke-${suffix}`;
const personal = !!process.env.DEEPSEEK_API_KEY && !!process.env.MCD_MCP_TOKEN;
const args = ["run", "--detach", "--rm", "--name", name, "--label", "com.mgo.test=smoke", "--publish", "127.0.0.1::3000", "--volume", "/app/.data", "--env", `APP_MODE=${personal ? "live" : "demo"}`];
if (personal) args.push("--env", "DEEPSEEK_API_KEY", "--env", "MCD_MCP_TOKEN", "--env", "DEEPSEEK_MODEL");
args.push(image);
let started = false;
try {
  execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }); started = true;
  const readBase = () => {
    const portText = execFileSync("docker", ["port", name, "3000/tcp"], { encoding: "utf8" }).trim();
    const port = portText.match(/:(\d+)$/)?.[1];
    if (!port) throw new Error("No loopback port assigned");
    return `http://127.0.0.1:${port}`;
  };
  let base = readBase();
  let ready = false;
  for (let i = 0; i < 30; i++) { try { ready = (await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(1000) })).ok; } catch {} if (ready) break; await setTimeout(500); }
  if (!ready) throw new Error("Container did not become ready");
  const configuration = await (await fetch(`${base}/api/config`)).json();
  if (configuration.mode !== (personal ? "live" : "demo")) throw new Error("Unexpected runtime mode");
  if (!(await (await fetch(base)).text()).includes("鲸鱼娘")) throw new Error("The game page did not render");
  if (!(await fetch(`${base}/art/character/v2/happy.webp`)).ok) throw new Error("Updated character asset is missing");
  const uid = execFileSync("docker", ["exec", name, "id", "-u"], { encoding: "utf8" }).trim();
  if (uid === "0") throw new Error("Container should not run as root");
  const firstResponse = await fetch(`${base}/api/session`), first = await firstResponse.json();
  if (!first.session?.id) throw new Error("Session did not initialize");
  if (personal) {
    const cookie = firstResponse.headers.get("set-cookie")?.split(";")[0];
    if (!cookie) throw new Error("Personal session cookie missing");
    const conversation = await fetch(`${base}/api/chat`, {
      method: "POST", signal: AbortSignal.timeout(125000),
      headers: { cookie, origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ message: "你好，先聊两句，不点餐也不下单。", requestId: crypto.randomUUID() }),
    });
    if (!conversation.ok) throw new Error("Compiled personal chat endpoint failed");
    const events = await conversation.text();
    if (!events.includes('"type":"reply"') || events.includes('"type":"error"')) throw new Error("Compiled MCP/model chat did not complete");
    if (events.includes(process.env.DEEPSEEK_API_KEY) || events.includes(process.env.MCD_MCP_TOKEN)) throw new Error("Credential appeared in a response; value hidden");
    execFileSync("docker", ["restart", name], { stdio: "pipe" });
    base = readBase();
    let restarted = false;
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${base}/api/config`, { signal: AbortSignal.timeout(1000) })).ok) { restarted = true; break; } } catch {} await setTimeout(500); }
    if (!restarted) throw new Error("Container did not become ready after restart");
    const second = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
    if (second.session?.id !== first.session.id) throw new Error("SQLite session was not retained across restart");
  }
  console.log(JSON.stringify({ dockerSmoke: "passed", mode: configuration.mode, nonRootUid: uid, staticAssets: true, compiledMcpAndModelChat: personal ? "passed" : "not-applicable", sqliteRestartPersistence: personal ? "passed" : "not-applicable", realOrderCreated: false }));
} finally {
  if (started) {
    const label = execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "com.mgo.test"}}', name], { encoding: "utf8" }).trim();
    if (label === "smoke") execFileSync("docker", ["stop", "--time", "3", name], { stdio: "pipe" });
  }
}
