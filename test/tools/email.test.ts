import { describe, expect, it, vi } from 'vitest';
import { QmailingClient } from '../../src/client.js';
import {
  getAttachmentTool,
  getEmailTool,
  handleGetAttachment,
  handleGetEmail,
  handleListEmails,
  handleSendEmail,
  listEmailsTool,
  sendEmailTool,
} from '../../src/tools/email.js';

function fakeClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    postMultipart: vi.fn(),
    getBytes: vi.fn(),
  } as unknown as QmailingClient;
}

describe('email tools', () => {
  it('listEmails passes no query when no filters supplied', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await handleListEmails(client, {});

    expect(client.get).toHaveBeenCalledWith('/api/v1/pub/email');
  });

  it('listEmails serialises every supplied filter into the query string', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await handleListEmails(client, {
      mailboxId: 'mb1',
      folder: 'SENT',
      offset: 5,
      limit: 50,
    });

    const arg = (client.get as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(arg).toContain('mailboxId=mb1');
    expect(arg).toContain('folder=SENT');
    expect(arg).toContain('offset=5');
    expect(arg).toContain('limit=50');
  });

  it('getEmail URL-encodes the id', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

    await handleGetEmail(client, { id: 'has space' });

    expect(client.get).toHaveBeenCalledWith('/api/v1/pub/email/has%20space');
  });

  it('sendEmail packs command + zero attachments into FormData', async () => {
    const client = fakeClient();
    (client.postMultipart as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'sent' });

    await handleSendEmail(client, {
      mailboxId: 'mb1',
      to: ['a@example.com'],
      subject: 'hi',
      bodyText: 'hello',
    });

    const calls = (client.postMultipart as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('/api/v1/pub/email/send');

    const form = calls[0][1] as FormData;
    // The "command" part must be a JSON file part (so Spring sees the
    // right Content-Type and binds it to SendEmailCommand). The
    // serialised payload must contain mailboxId + recipients verbatim.
    const commandPart = form.get('command') as File;
    expect(commandPart).toBeTruthy();
    // Explicit filename — see the comment in handleSendEmail. Node
    // fetch otherwise stamps "blob", which an older BE controller's
    // typed @RequestPart binding mishandled. The test pins our intent
    // so a future refactor that drops the filename argument is
    // caught before it ships.
    expect(commandPart.name).toBe('command.json');
    expect(commandPart.type).toBe('application/json');
    const text = await commandPart.text();
    // Wire format must be snake_case: BE Jackson is configured with
    // PropertyNamingStrategies.SNAKE_CASE globally, so a camelCase
    // `mailboxId` literally doesn't bind into SendEmailCommand and
    // every @NotNull on the record fires. Pin the on-the-wire shape
    // so a future regression of the snake_case conversion lands in
    // CI instead of in user-facing 400s.
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.mailbox_id).toBe('mb1');
    expect(parsed.to).toEqual(['a@example.com']);
    expect(parsed.subject).toBe('hi');
    // Defensive: camelCase keys must NOT leak through.
    expect(parsed.mailboxId).toBeUndefined();

    // No attachments → no part with that name.
    expect(form.getAll('attachments')).toEqual([]);
  });

  it('sendEmail decodes base64 attachments and forwards filename + content-type', async () => {
    const client = fakeClient();
    (client.postMultipart as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'sent' });

    // base64 of "hello"
    const helloB64 = Buffer.from('hello').toString('base64');

    await handleSendEmail(client, {
      mailboxId: 'mb1',
      to: ['a@example.com'],
      attachments: [
        { filename: 'note.txt', contentType: 'text/plain', base64: helloB64 },
        // No contentType → falls back to application/octet-stream.
        { filename: 'unknown.bin', base64: helloB64 },
      ],
    });

    const form = (client.postMultipart as ReturnType<typeof vi.fn>).mock.calls[0][1] as FormData;
    const parts = form.getAll('attachments');
    expect(parts).toHaveLength(2);

    const first = parts[0] as File;
    expect(first.name).toBe('note.txt');
    expect(first.type).toBe('text/plain');
    expect(await first.text()).toBe('hello');

    const second = parts[1] as File;
    expect(second.name).toBe('unknown.bin');
    expect(second.type).toBe('application/octet-stream');
  });

  it('tool descriptors expose stable names + required fields', () => {
    expect(listEmailsTool.name).toBe('qmailing_list_emails');
    expect(getEmailTool.inputSchema.required).toContain('id');
    expect(sendEmailTool.inputSchema.required).toEqual(['mailboxId', 'to']);
    expect(getAttachmentTool.name).toBe('qmailing_get_attachment');
    expect(getAttachmentTool.inputSchema.required).toEqual(['emailId', 'index']);
  });

  it('getAttachment URL-encodes the emailId and base64-encodes the body', async () => {
    const client = fakeClient();
    (client.getBytes as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      bytes: new TextEncoder().encode('hello'),
      contentType: 'text/plain',
      // RFC 6266 — Unicode round-trip via filename*=, with the ASCII
      // fallback escaped per AttachmentContentDisposition.
      contentDisposition:
        'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf',
    });

    const out = await handleGetAttachment(client, {
      emailId: 'has space',
      index: 2,
    });

    expect(client.getBytes).toHaveBeenCalledWith('/api/v1/pub/email/has%20space/attachments/2');
    expect(out.filename).toBe('report.pdf');
    expect(out.contentType).toBe('text/plain');
    expect(out.sizeBytes).toBe(5);
    expect(out.contentBase64).toBe(Buffer.from('hello').toString('base64'));
    expect(out.tooLarge).toBeUndefined();
  });

  it('getAttachment prefers UTF-8 extended filename when present', async () => {
    const client = fakeClient();
    (client.getBytes as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      bytes: new Uint8Array(),
      contentType: 'application/pdf',
      // Cyrillic original — percent-encoded in the extended form, the
      // ASCII fallback gets underscored by the BE sanitiser. The MCP
      // tool must recover the real name, not the fallback.
      contentDisposition:
        'attachment; filename="____.pdf"; filename*=UTF-8\'\'%D0%B7%D0%B2%D1%96%D1%82.pdf',
    });

    const out = await handleGetAttachment(client, { emailId: 'e', index: 0 });

    expect(out.filename).toBe('звіт.pdf');
  });

  it('getAttachment returns tooLarge sentinel above the 5 MiB cap', async () => {
    const client = fakeClient();
    // 5 MiB + 1 byte — exceeds the inline cap.
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    (client.getBytes as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      bytes: big,
      contentType: 'application/octet-stream',
      contentDisposition: null,
    });

    const out = await handleGetAttachment(client, { emailId: 'e', index: 0 });

    expect(out.tooLarge).toBe(true);
    expect(out.contentBase64).toBeUndefined();
    expect(out.sizeBytes).toBe(big.byteLength);
    // Missing Content-Disposition falls back to "download" rather than
    // surfacing a null filename to the LLM.
    expect(out.filename).toBe('download');
  });
});
