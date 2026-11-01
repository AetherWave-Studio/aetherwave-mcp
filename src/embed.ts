/**
 * Embed the AetherWave MCP tools inside another server (VoxBot Chat on the
 * platform): `import { connectEmbedded } from "@aetherwave-studio/mcp/embed"`.
 *
 * The embedder gets the SAME tools, schemas and descriptions as the npx and
 * remote servers, so an assistant built on it gains every new tool with a
 * package bump, and never drifts from the MCP contract.
 *
 * What the embedder still owns (this module does not do it for you):
 *   - Spending. Every tool whose TOOL_POLICY charge is "credits", or whose
 *     effect is "destructive", must be quoted and confirmed by the member
 *     before `call()`. `runsWithoutConfirm(name)` is the only free pass.
 *   - Auth. Pass the member's session as `headers` (e.g. Cookie and
 *     X-Forwarded-For on a loopback baseUrl); the platform routes then run
 *     their own payment gate, moderation and charge exactly as for a studio page.
 *   - The path allowlist, through `allowRequest`.
 *
 * Importing this module never starts the stdio server.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AetherwaveClient, type ApiClientOptions } from "./api.js";
import { toolPolicy, type ToolPolicy } from "./tool-policy.js";

(globalThis as any).__aetherwaveMcpEmbedded = true;
const { buildServer } = await import("./index.js");

export { buildServer, AetherwaveClient };
export type { ApiClientOptions };
export { TOOL_POLICY, toolPolicy, runsWithoutConfirm, type ToolPolicy, type ToolCharge, type ToolEffect } from "./tool-policy.js";
export { pickCharacter, applyCharacter, CHARACTER_DEFAULT_IMAGE_MODEL, type ResolvedCharacter } from "./characters.js";

/** A tool as the embedder offers it: the MCP definition plus its policy. */
export interface EmbeddedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  policy: ToolPolicy;
}

export interface EmbeddedSession {
  /** Tools safe to offer a signed-in member (policy embed: true). Tools with no policy are left out. */
  tools: EmbeddedTool[];
  /**
   * Run one tool. Refuses a name that is not in `tools`. It does NOT check
   * spend: confirm credit-spending and destructive tools before calling.
   * @returns the MCP tool result (content array, isError)
   */
  call(name: string, args: Record<string, unknown>): Promise<{ content: any[]; isError?: boolean }>;
  close(): Promise<void>;
}

/**
 * Build the tool server in remote mode (no local files, no operator tools)
 * against the given platform client options, and connect to it in-process.
 * @param clientOpts baseUrl, headers (member session) and allowRequest (path allowlist)
 */
export async function connectEmbedded(clientOpts: ApiClientOptions): Promise<EmbeddedSession> {
  const server = buildServer(new AetherwaveClient(clientOpts), { local: false });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const mcp = new Client({ name: "aetherwave-embed", version: "1" });
  await mcp.connect(clientSide);

  const tools: EmbeddedTool[] = [];
  for (const t of (await mcp.listTools()).tools) {
    const policy = toolPolicy(t.name);
    if (!policy || !policy.embed) continue;
    tools.push({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>, policy });
  }
  const offered = new Set(tools.map((t) => t.name));

  return {
    tools,
    async call(name, args) {
      if (!offered.has(name)) throw new Error(`Tool not offered here: ${name}`);
      return (await mcp.callTool({ name, arguments: args })) as { content: any[]; isError?: boolean };
    },
    async close() {
      await mcp.close();
      await server.close();
    },
  };
}
