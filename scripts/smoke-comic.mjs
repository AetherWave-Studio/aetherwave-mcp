// Manual smoke test of the comic tools over real MCP stdio. Spends NO credits:
// only reads, the free estimate, refusals, and (optionally) a free export.
//   AETHERWAVE_API_KEY=... [AETHERWAVE_BASE_URL=...] node scripts/smoke-comic.mjs <projectId> [--export]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectId = process.argv[2];
if (!projectId) { console.error("usage: node scripts/smoke-comic.mjs <projectId> [--export]"); process.exit(2); }
const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], env: { ...process.env } });
const client = new Client({ name: "comic-smoke", version: "0" });
await client.connect(transport);
const { tools } = await client.listTools();
const comic = tools.filter((t) => t.name.startsWith("aetherwave_comic_")).map((t) => t.name);
console.log(`tools: ${tools.length} total, ${comic.length} comic: ${comic.join(", ")}`);
const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  const body = r.content?.[0]?.text || "";
  let parsed; try { parsed = JSON.parse(body); } catch { parsed = body; }
  return { isError: !!r.isError, body: parsed };
};
const show = (label, r, pick) => console.log(label, r.isError ? "isError" : "ok", String(JSON.stringify(pick && typeof r.body === "object" ? pick(r.body) : r.body)).slice(0, 400));

show("estimate", await call("aetherwave_comic_estimate", { pageCount: 12 }));
show("status(list)", await call("aetherwave_comic_status", {}), (b) => ({ account: b.account, total: b.total, first: b.projects?.[0] }));
const st = await call("aetherwave_comic_status", { projectId });
show("status", st, (b) => ({ account: b.account, projectStatus: b.projectStatus, drawing: b.drawing, panels: b.panels, pages: { total: b.pages?.total, assembled: b.pages?.assembled }, failed: b.failedPanels?.length, next: b.nextStep }));
const detail = await call("aetherwave_comic_status", { projectId, detail: "panels" });
show("status(panels)", detail, (b) => ({ n: b.panelList?.length, first: b.panelList?.[0]?.panelId }));
const firstChar = st.body.characters?.[0];
if (firstChar) {
  show("approve tempfile (must refuse)", await call("aetherwave_comic_character_reference", {
    projectId, action: "approve", characterId: firstChar.characterId, imageUrl: "https://tempfile.aiquickdraw.com/x/fake.png" }), (b) => b.message?.slice(0, 120));
  show("character by wrong name (must refuse)", await call("aetherwave_comic_character_reference", {
    projectId, action: "approve", characterName: "Nobody At All", imageUrl: "https://media.aetherwavestudio.com/x.jpg" }), (b) => b.message);
}
show("write_script over existing panels (must refuse)", await call("aetherwave_comic_write_script", { projectId }), (b) => b.message);
show("draw on a finished book (must start nothing)", await call("aetherwave_comic_draw", { projectId }), (b) => b.message);
show("draw maxCredits 0 path", await call("aetherwave_comic_draw", { projectId, maxCredits: 0 }), (b) => b.message);
show("export with unknown exportId (must refuse)", await call("aetherwave_comic_export", { projectId, exportId: "00000000-0000-0000-0000-000000000000" }), (b) => b.message);
if (process.argv.includes("--export")) {
  const t0 = Date.now();
  const ex = await call("aetherwave_comic_export", { projectId, format: "pdf" });
  show(`export pdf (${Math.round((Date.now() - t0) / 1000)}s)`, ex);
  if (!ex.isError && ex.body.status === "building") {
    const again = await call("aetherwave_comic_export", { projectId, exportId: ex.body.exportId });
    show("export follow-up", again);
  }
}
await client.close();
