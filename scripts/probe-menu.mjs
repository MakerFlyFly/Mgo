import { writeFile, mkdir } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
try { process.loadEnvFile(".env.local"); } catch {}
const client = new Client({ name: "mgo-readonly-menu-probe", version: "0.1.0" });
function data(result) {
  if (result.structuredContent) return result.structuredContent;
  const text = result.content.filter(c => c.type === "text").map(c => c.text).join("\n");
  try { return JSON.parse(text); } catch { return { text }; }
}
try {
  await client.connect(new StreamableHTTPClientTransport(new URL("https://mcp.mcd.cn"), { requestInit: { headers: { Authorization: `Bearer ${process.env.MCD_MCP_TOKEN}` } } }), { timeout: 20000 });
  const stores = data(await client.callTool({ name: "query-nearby-stores", arguments: { beType: 1, searchType: 2, city: "上海市", keyword: "人民广场" } }));
  await mkdir("tmp", { recursive: true });
  await writeFile("tmp/real-stores.json", JSON.stringify(stores, null, 2));
  const list = Array.isArray(stores.data) ? stores.data : [];
  const store = list[0];
  if (!store) { console.log(JSON.stringify({ service: "nearby-stores", resultKeys: Object.keys(stores), dataType: typeof stores.data, count: list.length })); }
  else {
    const menu = data(await client.callTool({ name: "query-meals", arguments: { storeCode: String(store.storeCode), orderType: 1, beType: 1 } }));
    await writeFile("tmp/real-menu.json", JSON.stringify(menu, null, 2));
    console.log(JSON.stringify({ service: "readonly-live-menu", storeName: store.storeName, storeCount: list.length, menuRootKeys: Object.keys(menu), menuDataKeys: menu.data && typeof menu.data === "object" ? Object.keys(menu.data).slice(0, 15) : [] }));
    const entries = Object.entries(menu.data?.meals || {});
    const detailEntry = entries.find(([, item]) => item.name?.includes("套餐")) || entries[0];
    if (detailEntry) {
      const detail = data(await client.callTool({ name: "query-meal-detail", arguments: { storeCode: String(store.storeCode), orderType: 1, beType: 1, code: detailEntry[0] } }));
      await writeFile("tmp/real-detail.json", JSON.stringify(detail, null, 2));
      console.log(JSON.stringify({ service: "readonly-live-detail", name: detailEntry[1].name, dataKeys: Object.keys(detail.data || {}) }));
    }
    if (entries[0]) {
      const price = data(await client.callTool({ name: "calculate-price", arguments: { storeCode: String(store.storeCode), orderType: 1, beType: 1, needTableware: false, items: [{ productCode: entries[0][0], quantity: 1 }] } }));
      await writeFile("tmp/real-price.json", JSON.stringify(price, null, 2));
      console.log(JSON.stringify({ service: "readonly-live-price", ok: price.success, data: price.data }));
    }
  }
} catch (error) { console.log(JSON.stringify({ ok: false, code: error?.code ?? "READONLY_PROBE_FAILED" })); process.exitCode = 1; }
finally { await client.close().catch(() => {}); }
