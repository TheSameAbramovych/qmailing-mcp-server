import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { QmailingClient } from '../client.js';

interface CustomDomainDto {
  id: string;
  domain: string;
  fullyVerified: boolean;
  mxVerified: boolean;
  spfVerified: boolean;
  dkimVerified: boolean;
  dmarcVerified: boolean;
  sesVerificationStatus: string;
  claimedAt: string | null;
  createdAt: string;
}

interface DnsInstruction {
  type: 'MX' | 'TXT' | 'CNAME';
  host: string;
  value: string;
  priority: number | null;
  status: 'PENDING' | 'FOUND' | 'MISMATCH' | 'NOT_REQUIRED';
  description: string;
  lastCheckedAt: string | null;
}

export const listDomainsTool: Tool = {
  name: 'qmailing_list_domains',
  // Anthropic Connectors Directory requires `title` + a read/write
  // hint on every tool — the directory review rejects ~30% of
  // submissions for missing annotations (see
  // https://claude.com/docs/connectors/building/submission). Read-only
  // here: list endpoint, no state change.
  title: 'List custom domains',
  description:
    'List the custom domains this qmailing account owns. Each entry shows ' +
    'whether the ownership challenge has been claimed and whether MX / SPF / ' +
    'DKIM / DMARC have all gone green (fullyVerified). Useful for "is my ' +
    'domain ready?" questions.',
  annotations: {
    title: 'List custom domains',
    readOnlyHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export async function handleListDomains(client: QmailingClient): Promise<CustomDomainDto[]> {
  return client.get<CustomDomainDto[]>('/api/v1/pub/domains');
}

export const getDnsRecordsTool: Tool = {
  name: 'qmailing_get_dns_records',
  title: 'Get DNS records checklist',
  description:
    'Return the full DNS checklist (ownership TXT, MX, SPF, three DKIM ' +
    'CNAMEs, DMARC, optional _amazonses TXT) for a custom domain so the ' +
    'agent can tell the user exactly what to publish. Use when the user ' +
    'asks "what records do I need" or wants to check why DNS isn\'t verifying.',
  annotations: {
    title: 'Get DNS records checklist',
    readOnlyHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      domainId: {
        type: 'string',
        description: 'The domain UUID. Get one from qmailing_list_domains if you do not have it.',
      },
    },
    required: ['domainId'],
    additionalProperties: false,
  },
};

export async function handleGetDnsRecords(
  client: QmailingClient, args: { domainId: string },
): Promise<DnsInstruction[]> {
  return client.get<DnsInstruction[]>(
    `/api/v1/pub/domains/${encodeURIComponent(args.domainId)}/dns-records`,
  );
}
