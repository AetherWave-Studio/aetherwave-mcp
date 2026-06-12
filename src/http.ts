/**
 * Remote Streamable-HTTP host for the AetherWave MCP server.
 *
 * This wraps the SAME 16 tools as the stdio server (via buildServer) and serves
 * them over Streamable HTTP so the server can be hosted publicly and reached
 * from Anthropic's cloud (a prerequisite for the Connectors Directory).
 *
 * SPIKE auth: the caller supplies their own AetherWave API key per request via
 * `Authorization: Bearer aw_live_...` or `X-AW-Key`. A future OAuth consent flow
 * mints a token that resolves to the user's key; this header path is the bridge.
 *
 * Stateless mode: one fresh server+transport per request. Every tool is a
 * stateless HTTPS call to the AetherWave backend, so no per-session state needs
 * to persist between calls.
 */

// Claim the process BEFORE importing ./index.js so its stdio auto-run stays
// dormant. The dynamic import below runs after this assignment.
process.env.AETHERWAVE_MCP_HTTP = "1";

import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AetherwaveClient } from "./api.js";

const { buildServer } = await import("./index.js");

const PORT = Number(process.env.PORT) || 8787;
const BASE_URL = process.env.AETHERWAVE_BASE_URL;

function extractApiKey(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }
  const xkey = req.header("x-aw-key");
  if (xkey && xkey.trim()) return xkey.trim();
  return null;
}

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "aetherwave-mcp-http" });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const apiKey = extractApiKey(req);
  if (!apiKey || !apiKey.startsWith("aw_")) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Missing or invalid AetherWave API key. Supply it as 'Authorization: Bearer aw_live_...' or the 'X-AW-Key' header. Get a key at https://aetherwavestudio.com/developers.",
      },
      id: null,
    });
    return;
  }

  try {
    const client = new AetherwaveClient({ apiKey, baseUrl: BASE_URL });
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
});
