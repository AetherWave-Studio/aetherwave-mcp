// Weekly MCP tool audit, run by Windows Task Scheduler (Mondays 07:30 MT).
//
//   node scripts/weekly-audit.mjs [--budget 300] [--dry-post]
//
// Builds the current checkout, runs scripts/audit-tools.mjs against production
// with the credit cap, writes docs/audit-<date>.json and docs/TOOL-AUDIT-<date>.md,
// then posts ONE line to #claude-code-chat only when a tool fails, a tool
// response mismatches its contract, or the registered tool list changed since
// the previous audit. A clean week posts nothing.
//
// Secrets (STUDIO_ART_API_KEY, DISCORD_BOT_TOKEN) are read from the platform
// .env and never printed. --dry-post prints the Discord line instead of sending.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const BUDGET = Number(opt("--budget", 300));
const DRY_POST = argv.includes("--dry-post");
const CHANNEL = "1476688247991042069";
const date = new Date().toISOString().slice(0, 10);
const json = `docs/audit-${date}.json`;
const md = `docs/TOOL-AUDIT-${date}.md`;

const envText = (() => { try { return readFileSync(process.env.PLATFORM_ENV_FILE || "E:/Gits/AI-Record-Label-Maker/.env", "utf8"); } catch { return ""; } })();
const envVal = (k) => (envText.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");

// The previous audit is the newest docs/audit-*.json older than today.
const previous = readdirSync("docs").filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `audit-${date}.json`).sort().pop();

const run = (args) => execFileSync(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"] });
execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });

let crashed = null;
try {
  run(["scripts/audit-tools.mjs", "--budget", String(BUDGET), "--out", json]);
} catch (err) {
  crashed = err?.message?.split("\n")[0] || String(err);
}

const lines = [];
let report = null;
try { report = JSON.parse(readFileSync(json, "utf8")); } catch {}

if (report) {
  const table = execFileSync(process.execPath, ["scripts/render-audit.mjs", json], { encoding: "utf8" });
  writeFileSync(md, [
    `# MCP tool audit, ${date}`,
    "",
    `Weekly run by \`scripts/weekly-audit.mjs\` against production on the Boss-Free account (platform \`STUDIO_ART_API_KEY\`, never printed), credit cap ${BUDGET}. Raw record: \`${json}\`. Two tools are skipped by design: \`comic_redraw_panel\` permanently replaces a panel of a finished book, and \`shop_create_listing\` creates a real product.`,
    "",
    table,
  ].join("\n"));

  const fails = report.rows.filter((r) => r.result.startsWith("fail"));
  const mismatches = report.rows.filter((r) => r.mismatch && !r.result.startsWith("fail"));
  if (fails.length) lines.push(`${fails.length} fail: ${fails.map((r) => r.tool.replace("aetherwave_", "")).join(", ")}`);
  if (mismatches.length) lines.push(`${mismatches.length} contract mismatch: ${mismatches.map((r) => `${r.tool.replace("aetherwave_", "")} (${r.mismatch})`).join(", ")}`);

  if (previous) {
    const before = new Set(JSON.parse(readFileSync(`docs/${previous}`, "utf8")).registered || []);
    const now = new Set(report.registered || []);
    const added = [...now].filter((t) => !before.has(t));
    const removed = [...before].filter((t) => !now.has(t));
    if (added.length || removed.length) {
      lines.push(`tool list changed vs ${previous}: ${added.length ? "+" + added.join(" +") : ""}${removed.length ? " -" + removed.join(" -") : ""} (update README + platform docs tool count)`);
    }
  }
  const pass = report.rows.filter((r) => r.result.startsWith("pass")).length;
  console.log(`\nweekly audit ${date}: pass ${pass}, fail ${fails.length}, mismatch ${mismatches.length}, spent ${report.spentByDelta} of cap ${BUDGET}; wrote ${md}`);
  if (lines.length) lines.push(`pass ${pass}/${report.rows.length}, spent ${report.spentByDelta} cr of cap ${BUDGET}`);
}
if (crashed) lines.unshift(`runner crashed: ${crashed.slice(0, 300)}`);

if (lines.length) {
  const msg = `MCP weekly audit ${date}: ${lines.join("; ")}. Table: ${md} in the audit checkout. - mcp-desk (weekly cron)`.slice(0, 1990);
  if (DRY_POST) {
    console.log(`[dry-post] ${msg}`);
  } else {
    const token = process.env.DISCORD_BOT_TOKEN || envVal("DISCORD_BOT_TOKEN") || envVal("DISCORD_TOKEN");
    const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: msg }),
    });
    const body = await res.json().catch(() => ({}));
    // A rejected send is not a delivered send: only a returned message id counts.
    if (!res.ok || !body.id) {
      console.error(`Discord post FAILED (${res.status}); message was:\n${msg}`);
      process.exitCode = 1;
    } else {
      console.log(`Discord post delivered, message id ${body.id}`);
    }
  }
}
if (crashed) process.exitCode = 1;
