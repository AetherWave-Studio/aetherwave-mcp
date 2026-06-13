/**
 * Thin wrapper over the AetherWave Studio REST API. Centralizes auth header
 * handling, base URL config, and the submit-then-poll pattern shared by every
 * generation endpoint (image / video / music / band).
 */

const DEFAULT_BASE = "https://aetherwavestudio.com";

export interface ApiClientOptions {
  /** aw_live_ API key -> sent as X-AW-Key. */
  apiKey?: string;
  /** OAuth access token (awo_) -> forwarded as Authorization: Bearer; the
   *  AetherWave backend resolves it to the user (MCP Connector / OAuth path). */
  bearerToken?: string;
  baseUrl?: string;
}

export class AetherwaveClient {
  private readonly apiKey?: string;
  private readonly bearerToken?: string;
  private readonly baseUrl: string;

  constructor(opts: ApiClientOptions) {
    this.apiKey = opts.apiKey;
    this.bearerToken = opts.bearerToken;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
    if (!this.apiKey && !this.bearerToken) {
      throw new Error("AetherwaveClient requires an apiKey or a bearerToken");
    }
  }

  /** Auth header: OAuth bearer (forwarded; backend resolves) or X-AW-Key. */
  private authHeaders(): Record<string, string> {
    if (this.bearerToken) return { Authorization: `Bearer ${this.bearerToken}` };
    return { "X-AW-Key": this.apiKey as string };
  }

  /** Authenticated POST. Throws on non-2xx with the error body attached. */
  async post<T = any>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return await this.handle<T>(res, path);
  }

  /**
   * GET. Sends auth header when auth = "key", omits it for "public" endpoints.
   */
  async get<T = any>(path: string, auth: "key" | "public" = "key"): Promise<T> {
    const headers: Record<string, string> = auth === "key" ? this.authHeaders() : {};
    const res = await fetch(`${this.baseUrl}${path}`, { headers });
    return await this.handle<T>(res, path);
  }

  private async handle<T>(res: Response, path: string): Promise<T> {
    if (!res.ok) {
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => "");
      }
      const message =
        typeof body === "object" && body && (body.error || body.message)
          ? `${body.error || body.message}`
          : typeof body === "string"
            ? body
            : `HTTP ${res.status}`;
      const err = new Error(
        `AetherWave API ${path} failed: ${res.status} - ${message}`,
      );
      (err as any).status = res.status;
      (err as any).body = body;
      throw err;
    }
    return (await res.json()) as T;
  }

  /**
   * Submit a generation, poll its status endpoint until terminal, return the
   * final status payload. Used by every generate_* tool so the LLM gets a
   * single round-trip instead of having to write its own polling loop.
   *
   * @param submitPath endpoint that returns { taskId, ... }
   * @param submitBody body to POST
   * @param statusPath function that builds the status URL from a taskId
   * @param opts.timeoutMs how long to wait for terminal state (default 6m)
   * @param opts.pollIntervalMs interval between polls (default 3s)
   * @param opts.successStates lowercased terminal-success values to watch for
   * @param opts.failureStates lowercased terminal-failure values to watch for
   */
  async submitAndPoll<TStatus = any>(opts: {
    submitPath: string;
    submitBody: unknown;
    statusPath: (taskId: string) => string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    successStates?: string[];
    failureStates?: string[];
  }): Promise<{ taskId: string; status: TStatus }> {
    const {
      submitPath,
      submitBody,
      statusPath,
      timeoutMs = 360_000,
      pollIntervalMs = 3_000,
      successStates = ["success", "complete", "completed", "succeeded", "done"],
      failureStates = ["failed", "failure", "error", "rejected", "cancelled"],
    } = opts;

    const submitResp = await this.post<any>(submitPath, submitBody);
    const taskId: string | undefined =
      submitResp?.taskId || submitResp?.task_id || submitResp?.id;
    if (!taskId) {
      throw new Error(
        `AetherWave API ${submitPath} did not return a taskId. Response: ${JSON.stringify(
          submitResp,
        ).slice(0, 300)}`,
      );
    }

    const deadline = Date.now() + timeoutMs;
    const successSet = new Set(successStates.map((s) => s.toLowerCase()));
    const failureSet = new Set(failureStates.map((s) => s.toLowerCase()));

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      let status: any;
      try {
        status = await this.get<any>(statusPath(taskId));
      } catch (err: any) {
        // 404 right after submit can occur as the in-memory task store warms.
        // Treat as transient and keep polling unless we've burned half the
        // budget on 404s.
        if (err?.status === 404 && Date.now() < deadline - timeoutMs / 2) {
          continue;
        }
        throw err;
      }
      const state = String(status?.state || status?.status || "").toLowerCase();
      if (successSet.has(state)) return { taskId, status };
      if (failureSet.has(state)) {
        const errorMsg =
          status?.error || status?.message || `state=${status?.state || state}`;
        throw new Error(
          `AetherWave generation failed (taskId=${taskId}): ${errorMsg}`,
        );
      }
    }
    throw new Error(
      `AetherWave generation timed out after ${Math.round(
        timeoutMs / 1000,
      )}s (taskId=${taskId}). The job may still complete server-side; check the AetherWave gallery.`,
    );
  }
}
