import { describe, expect, it, vi } from 'vitest';
import { QmailingClient } from '../../src/client.js';
import {
  deleteWebhookTool,
  handleDeleteWebhook,
  handleListWebhooks,
  handleRegisterWebhook,
  listWebhooksTool,
  registerWebhookTool,
} from '../../src/tools/webhooks.js';

function fakeClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    postMultipart: vi.fn(),
  } as unknown as QmailingClient;
}

describe('webhook tools', () => {
  it('registerWebhook POSTs the full payload', async () => {
    const client = fakeClient();
    (client.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ endpoint: {}, plaintext: 'whk_x' });

    const result = await handleRegisterWebhook(client, {
      url: 'https://example.com/h',
      label: 'ci',
      events: ['email.received'],
    });

    expect(client.post).toHaveBeenCalledWith('/api/v1/pub/webhooks', {
      url: 'https://example.com/h',
      label: 'ci',
      events: ['email.received'],
    });
    expect(result.plaintext).toBe('whk_x');
  });

  it('listWebhooks hits /api/v1/pub/webhooks', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'w1' }]);

    const result = await handleListWebhooks(client);

    expect(client.get).toHaveBeenCalledWith('/api/v1/pub/webhooks');
    expect(result).toEqual([{ id: 'w1' }]);
  });

  it('deleteWebhook URL-encodes the id', async () => {
    const client = fakeClient();
    (client.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await handleDeleteWebhook(client, { id: 'has space' });

    expect(client.delete).toHaveBeenCalledWith('/api/v1/pub/webhooks/has%20space');
  });

  it('tool descriptors expose stable names + required fields', () => {
    expect(registerWebhookTool.name).toBe('qmailing_register_webhook');
    expect(registerWebhookTool.inputSchema.required).toEqual(['url', 'label', 'events']);
    expect(listWebhooksTool.name).toBe('qmailing_list_webhooks');
    expect(deleteWebhookTool.inputSchema.required).toContain('id');
  });
});
