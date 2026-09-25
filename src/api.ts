/**
 * Thin wrapper over the AetherWave Studio REST API. Centralizes auth header
 * handling, base URL config, and the submit-then-poll pattern shared by every
 * generation endpoint (image / video / music / band).
 */

import { createRequire } from "node:module";

const DEFAULT_BASE = "https://aetherwavestudio.com";

/* EVERY REQUEST DECLARES ITS CLIENT VERSION.
 *
 * Without this the platform has no idea who is running old code, and npm gives
 * you no way to tell them: a deprecation warning prints to stderr on install,
 * and an MCP server's stderr goes to a log file nobody opens. So the users most
 * likely to be stuck on an old build are exactly the ones who never see the
 * notice.
 *
 * This header is the enabling half of the fix. Once the server can see the
 * version, it can return an upgrade notice inside a normal tool response - and
 * tool responses are read aloud by the assistant, which is the ONE channel that
 * reaches an npx user in the place they are actually looking. */
const CLIENT_VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)("../package.json").version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
const CLIENT_UA = `@aetherwave-studio/mcp/${CLIENT_VERSION}`;

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

  /** Auth header: OAuth bearer (forwarded; backend resolves) or X-AW-Key.
   *  Always carries the client version so the platform can spot stale installs. */
  private authHeaders(): Record<string, string> {
    const ident = {
      "X-AW-Client": CLIENT_UA,
      "User-Agent": CLIENT_UA,
    };
    if (this.bearerToken)
      return { ...ident, Authorization: `Bearer ${this.bearerToken}` };
    return { ...ident, "X-AW-Key": this.apiKey as string };
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

  /**
   * Authenticated request with a client-side deadline, for long jobs that must
   * START and RETURN instead of blocking (the comic tools).
   *
   * - On the deadline the fetch is aborted and an error with `timedOut = true`
   *   is thrown. Aborting only stops OUR wait: the server keeps working, so a
   *   caller must report "still running, check status", never "failed".
   * - A 2xx that is not JSON (e.g. a server too old to know `deliver: "url"`
   *   streaming a 130 MB PDF back) is refused without reading the body, and
   *   the error carries `notJson = true`.
   * - Errors carry `status` and `body` exactly like post()/get().
   */
  async request<T = any>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ status: number; data: T }> {
    const controller = new AbortController();
    const timer = opts.timeoutMs
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : null;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers:
          method === "POST"
            ? { ...this.authHeaders(), "Content-Type": "application/json" }
            : this.authHeaders(),
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      if (err?.name === "AbortError") {
        const e = new Error(
          `AetherWave API ${path} is still working after ${Math.round(
            (opts.timeoutMs || 0) / 1000,
          )}s. The server keeps going; check status instead of retrying.`,
        );
        (e as any).timedOut = true;
        throw e;
      }
      throw err;
    }
    if (timer) clearTimeout(timer);
    if (!res.ok) return { status: res.status, data: await this.handle<T>(res, path) };
    const type = res.headers.get("content-type") || "";
    if (!type.includes("application/json")) {
      await res.body?.cancel().catch(() => {});
      const e = new Error(
        `AetherWave API ${path} answered ${res.status} with ${type || "no content type"} instead of JSON.`,
      );
      (e as any).status = res.status;
      (e as any).notJson = true;
      throw e;
    }
    return { status: res.status, data: (await res.json()) as T };
  }

  private identity?: Promise<{ username: string | null; credits: number | null; plan: string | null }>;

  /**
   * Which account this credential bills, looked up once per client.
   *
   * Two MCP connections on one machine resolved to two different accounts on
   * 2026-09-25 (a user-level env var shadowed the machine one) and nothing in
   * any tool result said so. Tools that spend credits put this in their result.
   * Never throws: an unknown account is reported as null, not as a failed tool.
   */
  whoami(): Promise<{ username: string | null; credits: number | null; plan: string | null }> {
    if (!this.identity) {
      this.identity = this.get<any>("/api/quickstart/balance")
        .then((d) => ({
          username: d?.username ?? null,
          credits: typeof d?.credits === "number" ? d.credits : null,
          plan: d?.subscription_plan ?? null,
        }))
        .catch(() => {
          this.identity = undefined; // retry on the next call
          return { username: null, credits: null, plan: null };
        });
    }
    return this.identity;
  }

  private async handle<T>(res: Response, path: string): Promise<T> {
    if (!res.ok) {
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => "");
      }
      /* `details` MUST be surfaced. The platform puts a generic label in
       * `error` and the ACTIONABLE reason in `details`, e.g.
       *   { error: "Generation failed",
       *     details: "The length of music style cannot exceed 1000 characters" }
       *
       * Reading only `error` produced "500 - Generation failed" and nothing
       * more, so on 2026-08-11 a developer could not distinguish a length limit
       * from an outage. He diagnosed it only by opening the browser console on
       * the web app, which an MCP client has no equivalent of. Upstream limit
       * errors are the most common failure on this path and they are ALWAYS
       * in `details`. */
      const detail =
        typeof body === "object" && body && body.details
          ? ` (${body.details})`
          : "";
      const message =
        typeof body === "object" && body && (body.error || body.message)
          ? `${body.error || body.message}${detail}`
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

    /* Tolerate a run of gateway blips before giving up on an already-paid job.
     * At the 3s default poll interval this is ~2 minutes of upstream trouble. */
    const MAX_CONSECUTIVE_TRANSIENT = 40;
    let consecutiveTransient = 0;

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
        /* A GATEWAY BLIP MUST NOT DESTROY A PAID GENERATION.
         *
         * The job is already submitted and already billed; it is running
         * server-side and its result will land in the gallery whatever happens
         * to this poll. Throwing on a single 502 abandons a clip the caller has
         * paid for and hands back an error that reads like the generation
         * failed, which it did not. Observed 2026-09-25: a 502 on one status
         * poll killed an otherwise healthy seedance-2-mini render.
         *
         * Transient upstream statuses are therefore retried for as long as the
         * budget allows. A persistent outage still ends at the deadline, whose
         * message points at the gallery. */
        const transient = err?.status === 408 || err?.status === 429 || (err?.status >= 500 && err?.status <= 599);
        if (transient) {
          consecutiveTransient += 1;
          if (consecutiveTransient <= MAX_CONSECUTIVE_TRANSIENT) continue;
          throw new Error(
            `AetherWave status polling failed ${consecutiveTransient} times in a row (last: ${err?.status}) for taskId=${taskId}. ` +
              `The generation may still complete server-side; check the AetherWave gallery.`,
          );
        }
        throw err;
      }
      consecutiveTransient = 0;
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
