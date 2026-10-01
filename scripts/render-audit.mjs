// Renders docs/TOOL-AUDIT-<date>.md from the JSON that scripts/audit-tools.mjs wrote.
//   node scripts/render-audit.mjs docs/audit-2026-09-30.json > /tmp/table.md
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(process.argv[2] || "docs/audit-2026-09-30.json", "utf8"));
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const argsOf = (r) => {
  const a = { ...(r.args || {}) };
  for (const k of Object.keys(a)) if (typeof a[k] === "string" && a[k].length > 60) a[k] = a[k].slice(0, 40) + "…";
  const s = JSON.stringify(a);
  return s === "{}" ? "" : "`" + esc(s) + "`";
};
console.log("| # | Tool | Args | Result | Tool wall time | Followed with get_job | Credits | Note |");
console.log("|---|------|------|--------|---------------:|-----------------------|--------:|------|");
let i = 0;
for (const r of j.rows) {
  i++;
  const followed = r.followed ? `${r.followed.polls} polls, ${(r.followed.ms / 1000).toFixed(0)} s` : "";
  const note = [r.note, r.mismatch ? `MISMATCH: ${r.mismatch}` : ""].filter(Boolean).join("; ");
  console.log(`| ${i} | \`${r.tool}\` | ${argsOf(r)} | ${esc(r.result)} | ${r.ms ? (r.ms / 1000).toFixed(1) + " s" : ""} | ${followed} | ${r.credits ?? ""} | ${esc(note)} |`);
}
const pass = j.rows.filter((r) => r.result.startsWith("pass")).length;
const fail = j.rows.filter((r) => r.result.startsWith("fail")).length;
const notRun = j.rows.filter((r) => r.result.startsWith("not run")).length;
console.log(`\nrows ${j.rows.length}: pass ${pass}, fail ${fail}, not run ${notRun}; credits by balance delta this run ${j.spentByDelta} (start ${j.startBalance}, end ${j.endBalance})`);
