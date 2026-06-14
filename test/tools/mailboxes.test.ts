import { describe, expect, it, vi } from 'vitest';
import { QmailingClient } from '../../src/client.js';
import {
  handleCreateMailbox,
  handleGetMailbox,
  handleListMailboxes,
  createMailboxTool,
  getMailboxTool,
  listMailboxesTool,
} from '../../src/tools/mailboxes.js';

function fakeClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    postMultipart: vi.fn(),
  } as unknown as QmailingClient;
}

describe('mailbox tools', () => {
  it('listMailboxes hits /api/v1/pub/mailboxes', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'm1' }]);

    const result = await handleListMailboxes(client);

    expect(client.get).toHaveBeenCalledWith('/api/v1/pub/mailboxes');
    expect(result).toEqual([{ id: 'm1' }]);
  });

  it('getMailbox URL-encodes the id path segment', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'safe' });

    await handleGetMailbox(client, { id: 'with space' });

    expect(client.get).toHaveBeenCalledWith('/api/v1/pub/mailboxes/with%20space');
  });

  it('createMailbox POSTs the full command shape', async () => {
    const client = fakeClient();
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'm-new' });

    await handleCreateMailbox(client, {
      localPart: 'support',
      domain: 'example.com',
      displayName: 'Support team',
      forwardTo: 'ops@example.com',
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/pub/mailboxes', {
      localPart: 'support',
      domain: 'example.com',
      displayName: 'Support team',
      forwardTo: 'ops@example.com',
    });
  });

  it('tool descriptors expose stable names + JSON schemas', () => {
    expect(listMailboxesTool.name).toBe('qmailing_list_mailboxes');
    expect(getMailboxTool.inputSchema.required).toContain('id');
    expect(createMailboxTool.inputSchema.required).toContain('localPart');
  });
});
