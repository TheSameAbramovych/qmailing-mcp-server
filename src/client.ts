/**
 * Thin HTTP client for the qmailing public API. All endpoints live
 * under {@code /api/v1/pub/} and authenticate via Bearer token.
 *
 * <p>The client is deliberately minimalist: no caching, no retry, no
 * tracing. The MCP server runs on the user's own machine and the
 * transport is a couple of localhost-to-cloud calls per tool
 * invocation — the simpler the wrapper, the easier it is for users to
 * audit before they paste their token in.
 *
 * <p>Errors are surfaced as a single {@link QmailingApiError} carrying
 * the status code, the optional ProblemDetail {@code code} field, and
 * a human-readable message. Tool handlers translate this into the
 * structured error contract MCP clients expect.
 */
export class QmailingApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * Stable machine-readable code from the server's
     * RFC-7807-ish ProblemDetail body (e.g. "InsufficientScope",
     * "PlanFeatureRequired", "RateLimitExceeded"). Tools branch on
     * this so the error returned to the LLM is consistent across
     * locales.
     */
    public readonly code?: string,
    public readonly body?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'QmailingApiError';
  }
}

export interface QmailingClientConfig {
  /** Base URL with no trailing slash. Defaults to {@code https://qmailing.com}. */
  baseUrl: string;
  /** Bearer token (the {@code qm_live_<…>} value the user copied from /settings/developers). */
  token: string;
}

export class QmailingClient {
  constructor(private readonly cfg: QmailingClientConfig) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /**
   * multipart/form-data POST. Used by the email-send tool: the
   * server expects a {@code command} JSON part plus zero-or-more
   * {@code attachments} file parts. We let the platform's FormData
   * + Blob construction handle boundary generation and Content-Type
   * (set automatically when the body is FormData) so the wire shape
   * matches the internal compose endpoint exactly.
   */
  async postMultipart<T>(path: string, form: FormData): Promise<T> {
    return this.request<T>('POST', path, form, /* multipart */ true);
  }

  async delete(path: string): Promise<void> {
    await this.request<void>('DELETE', path);
  }

  /**
   * Binary GET. Used by the attachment-download tool: the BE streams
   * raw bytes through {@code GET /api/v1/pub/email/{id}/attachments/{i}}
   * with the original Content-Type + RFC-6266 Content-Disposition. We
   * surface the bytes + both headers so the caller can decide how to
   * package them (the tool base64-encodes inline and returns the
   * filename pulled from Content-Disposition).
   *
   * <p>Error handling matches the JSON path: a non-2xx response is
   * parsed as ProblemDetail when JSON-shaped, otherwise the HTTP
   * status alone surfaces as the detail. The token / scope checks on
   * the BE run before any body bytes get streamed, so a 401/403 has
   * a JSON body and a 200 has the binary payload.
   */
  async getBytes(path: string): Promise<{
    bytes: Uint8Array;
    contentType: string;
    contentDisposition: string | null;
  }> {
    const url = `${this.cfg.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.cfg.token}`,
        'Accept': 'application/octet-stream, */*',
        'User-Agent': 'qmailing-mcp/0.2',
      },
    });
    if (!res.ok) {
      let parsed: Record<string, unknown> | undefined;
      let detail = `HTTP ${res.status}`;
      let code: string | undefined;
      try {
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          parsed = raw as Record<string, unknown>;
          const d = parsed.detail;
          const t = parsed.title;
          const c = parsed.code;
          if (typeof d === 'string') detail = d;
          else if (typeof t === 'string') detail = t;
          if (typeof c === 'string') code = c;
        }
      } catch {
        // Empty / non-JSON body — keep the HTTP status as the detail.
      }
      throw new QmailingApiError(res.status, detail, code, parsed);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: buf,
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      contentDisposition: res.headers.get('content-disposition'),
    };
  }

  private async request<T>(method: string, path: string, body?: unknown,
                            multipart: boolean = false): Promise<T> {
    const url = `${this.cfg.baseUrl}${path}`;
    // Multipart: hand the FormData straight to fetch — the runtime
    // sets Content-Type with the right boundary. Setting it ourselves
    // would corrupt the boundary in the body.
    const isMultipart = multipart && body !== undefined;
    const init: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.cfg.token}`,
        'Accept': 'application/json',
        'User-Agent': 'qmailing-mcp/0.1',
        ...(body !== undefined && !isMultipart ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined
        ? undefined
        : isMultipart
          ? (body as FormData)
          : JSON.stringify(body),
    };
    const res = await fetch(url, init);

    if (!res.ok) {
      let parsed: Record<string, unknown> | undefined;
      let detail = `HTTP ${res.status}`;
      let code: string | undefined;
      try {
        const raw = (await res.json()) as unknown;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          parsed = raw as Record<string, unknown>;
          const d = parsed.detail;
          const t = parsed.title;
          const c = parsed.code;
          if (typeof d === 'string') detail = d;
          else if (typeof t === 'string') detail = t;
          if (typeof c === 'string') code = c;
        }
      } catch {
        // Empty / non-JSON body — keep the HTTP status as the detail.
      }
      throw new QmailingApiError(res.status, detail, code, parsed);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}
