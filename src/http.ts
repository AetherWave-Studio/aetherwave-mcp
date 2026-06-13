/**
 * Remote Streamable-HTTP host for the AetherWave MCP server (the OAuth
 * "resource server" Claude connects to).
 *
 * Serves the SAME 16 tools as the stdio server (via buildServer) over Streamable
 * HTTP. Two credential modes per request:
 *   - OAuth access token  (Authorization: Bearer awo_...) -> forwarded to the
 *     AetherWave backend, which resolves it to the user (Connectors Directory).
 *   - Raw API key         (X-AW-Key / Bearer aw_live_...) -> sent as X-AW-Key
 *     (dev / direct use).
 *
 * On a request with NO credential we return 401 + WWW-Authenticate pointing at
 * our Protected Resource Metadata, which kicks off the OAuth flow: Claude reads
 * the PRM, finds the authorization server (the AetherWave platform), registers
 * (DCR), runs the consent + PKCE dance, and reconnects with a token.
 *
 * Stateless mode: one fresh server+transport per request (tools are stateless
 * HTTPS calls to the backend).
 */

// Claim the process BEFORE importing ./index.js so its stdio auto-run stays
// dormant. The dynamic import below runs after this assignment.
process.env.AETHERWAVE_MCP_HTTP = "1";

import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AetherwaveClient } from "./api.js";

const { buildServer } = await import("./index.js");

const PORT = Number(process.env.PORT) || 8787;
const BASE_URL = process.env.AETHERWAVE_BASE_URL; // AetherWave API the tools call
// The authorization server (the AetherWave platform serves /oauth/* + AS metadata).
const AUTH_SERVER = (process.env.OAUTH_ISSUER || "https://aetherwavestudio.com").replace(/\/+$/, "");
// This host's own public base URL (set at deploy, e.g. https://mcp.aetherwavestudio.com).
const PUBLIC_URL = (process.env.MCP_PUBLIC_URL || "https://mcp.aetherwavestudio.com").replace(/\/+$/, "");
const RESOURCE_URL = process.env.OAUTH_MCP_RESOURCE || `${PUBLIC_URL}/mcp`;
const PRM_URL = `${PUBLIC_URL}/.well-known/oauth-protected-resource`;

type Credential = { mode: "oauth" | "key"; token: string };

function extractCredential(req: Request): Credential | null {
  let token: string | null = null;
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    const xkey = req.header("x-aw-key");
    if (xkey && xkey.trim()) token = xkey.trim();
  }
  if (!token) return null;
  if (token.startsWith("awo_")) return { mode: "oauth", token }; // OAuth access token
  if (token.startsWith("aw_")) return { mode: "key", token }; // aw_live_ API key
  return null; // unrecognized credential format
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "aetherwave-mcp-http" });
});

// Protected Resource Metadata (RFC 9728). Points Claude at the authorization
// server (the AetherWave platform) so it can register + run the OAuth flow.
app.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
  res.json({
    resource: RESOURCE_URL,
    authorization_servers: [AUTH_SERVER],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  });
});

function challenge(res: Response) {
  // Tell the client where to find the resource metadata to begin OAuth.
  res.setHeader("WWW-Authenticate", `Bearer resource_metadata="${PRM_URL}"`);
  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message:
        "Authentication required. Connect your AetherWave account via OAuth, or supply an API key (X-AW-Key / Bearer aw_live_...). Get a key at https://aetherwavestudio.com/developers.",
    },
    id: null,
  });
}

app.post("/mcp", async (req: Request, res: Response) => {
  const cred = extractCredential(req);
  if (!cred) {
    challenge(res);
    return;
  }

  try {
    const client =
      cred.mode === "oauth"
        ? new AetherwaveClient({ bearerToken: cred.token, baseUrl: BASE_URL })
        : new AetherwaveClient({ apiKey: cred.token, baseUrl: BASE_URL });
    const server = buildServer(client);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless mode has no long-lived SSE stream or server-managed session.
function methodNotAllowed(_req: Request, res: Response) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This server runs in stateless mode; use POST /mcp.",
    },
    id: null,
  });
}
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.error(`AetherWave MCP remote host listening on :${PORT} (POST /mcp)`);
  console.error(`  resource: ${RESOURCE_URL}`);
  console.error(`  authorization server: ${AUTH_SERVER}`);
});
