import { describe, expect, it, vi } from 'vitest';
import { QmailingClient } from '../../src/client.js';
import {
  getDnsRecordsTool,
  handleGetDnsRecords,
  handleListDomains,
  listDomainsTool,
} from '../../src/tools/domains.js';

function fakeClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    postMultipart: vi.fn(),
  } as unknown as QmailingClient;
}

describe('domain tools', () => {
  it('listDomains hits /api/v1/pub/domains', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 'd1' }]);

    const result = await handleListDomains(client);

    expect(client.get).toHaveBeenCalledWith('/api/v1/pub/domains');
    expect(result).toEqual([{ id: 'd1' }]);
  });

  it('getDnsRecords builds the per-domain dns-records path with URL encoding', async () => {
    const client = fakeClient();
    (client.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await handleGetDnsRecords(client, { domainId: 'with space' });

    expect(client.get).toHaveBeenCalledWith('/api/v1/pub/domains/with%20space/dns-records');
  });

  it('tool descriptors expose stable names + JSON schemas', () => {
    expect(listDomainsTool.name).toBe('qmailing_list_domains');
    expect(getDnsRecordsTool.inputSchema.required).toContain('domainId');
  });
});
