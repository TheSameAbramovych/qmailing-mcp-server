import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QmailingApiError, QmailingClient } from '../src/client.js';

const cfg = { baseUrl: 'https://api.test', token: 'qm_live_secret' };

describe('QmailingClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as unknown as ReturnType<typeof vi.spyOn>;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('GET sets Bearer token + Accept and parses JSON', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, [{ id: 'x' }]));
    const client = new QmailingClient(cfg);

    const result = await client.get<{ id: string }[]>('/api/v1/pub/mailboxes');

    expect(result).toEqual([{ id: 'x' }]);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/api/v1/pub/mailboxes');
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer qm_live_secret');
    expect(headers.Accept).toBe('application/json');
    // GET should NOT set Content-Type (no body), per fetch spec.
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('POST with JSON body stamps Content-Type and serialises the payload', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(201, { ok: true }));
    const client = new QmailingClient(cfg);

    await client.post<unknown>('/api/v1/pub/webhooks', { url: 'https://x', label: 'ci', events: ['*'] });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ url: 'https://x', label: 'ci', events: ['*'] }));
  });

  it('multipart POST hands FormData straight through and skips Content-Type', async () => {
    // FormData isn't ambient in Node 18 typings but is at runtime; cast at use site.
    fetchSpy.mockResolvedValueOnce(jsonResponse(201, { ok: true }));
    const client = new QmailingClient(cfg);

    const fd = new FormData();
    fd.append('command', new Blob([JSON.stringify({ a: 1 })], { type: 'application/json' }));
    fd.append('attachments', new Blob([new Uint8Array([1, 2])], { type: 'image/png' }), 'pixel.png');

    await client.postMultipart<unknown>('/api/v1/pub/email/send', fd);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // Critical: setting Content-Type ourselves would corrupt the
    // multipart boundary the runtime appends to the auto-derived
    // Content-Type. Verify we did NOT set it.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init.body).toBe(fd);
  });

  it('204 No Content returns undefined without trying to parse a body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new QmailingClient(cfg);

    const result = await client.delete('/api/v1/pub/webhooks/abc');
    expect(result).toBeUndefined();
  });

  it('200 with empty body returns undefined', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 200 }));
    const client = new QmailingClient(cfg);
    const result = await client.get<unknown>('/api/v1/pub/empty');
    expect(result).toBeUndefined();
  });

  it('non-2xx ProblemDetail body lifts detail + code into the thrown error', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(403, {
      title: 'Forbidden', detail: 'Token is missing scope', code: 'InsufficientScope',
      requiredScopes: ['email:send'],
    }));
    const client = new QmailingClient(cfg);

    await expect(client.post<unknown>('/api/v1/pub/email/send', {}))
      .rejects.toMatchObject({
        status: 403,
        message: 'Token is missing scope',
        code: 'InsufficientScope',
      });
  });

  it('falls back to title when detail is missing', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(429, { title: 'Too Many Requests' }));
    const client = new QmailingClient(cfg);

    await expect(client.get<unknown>('/api/v1/pub/mailboxes'))
      .rejects.toMatchObject({ status: 429, message: 'Too Many Requests' });
  });

  it('handles non-JSON error bodies gracefully (HTTP-status fallback)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('<html>500</html>', {
      status: 500, headers: { 'content-type': 'text/html' },
    }));
    const client = new QmailingClient(cfg);

    await expect(client.get<unknown>('/api/v1/pub/mailboxes'))
      .rejects.toMatchObject({ status: 500, message: 'HTTP 500' });
  });

  it('QmailingApiError.name is the class name (so consumers can branch on it)', () => {
    const e = new QmailingApiError(401, 'nope');
    expect(e.name).toBe('QmailingApiError');
    expect(e.code).toBeUndefined();
    expect(e.body).toBeUndefined();
  });

  it('getBytes returns the raw bytes + content-type + content-disposition', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    fetchSpy.mockResolvedValueOnce(new Response(payload, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-disposition': 'attachment; filename="pixel.png"',
      },
    }));
    const client = new QmailingClient(cfg);

    const out = await client.getBytes('/api/v1/pub/email/abc/attachments/0');

    expect(Array.from(out.bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(out.contentType).toBe('image/png');
    expect(out.contentDisposition).toBe('attachment; filename="pixel.png"');
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization)
      .toBe('Bearer qm_live_secret');
  });

  it('getBytes maps a non-2xx ProblemDetail body to QmailingApiError', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(403, {
      detail: 'token missing scope', code: 'InsufficientScope',
    }));
    const client = new QmailingClient(cfg);

    await expect(client.getBytes('/api/v1/pub/email/x/attachments/0'))
      .rejects.toMatchObject({
        status: 403,
        message: 'token missing scope',
        code: 'InsufficientScope',
      });
  });

  it('getBytes defaults content-type and content-disposition when the response omits them', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([9]), { status: 200 }));
    const client = new QmailingClient(cfg);

    const out = await client.getBytes('/some');

    expect(out.contentType).toBe('application/octet-stream');
    expect(out.contentDisposition).toBeNull();
  });

  it('JSON arrays in the error body are not treated as ProblemDetail', async () => {
    // A misconfigured server might return a top-level JSON array for
    // an error; the parser must not attempt to read .detail / .code
    // off of it. The thrown error keeps the status fallback.
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, ['weird']));
    const client = new QmailingClient(cfg);

    await expect(client.get<unknown>('/x'))
      .rejects.toMatchObject({ status: 500, message: 'HTTP 500' });
  });
});
