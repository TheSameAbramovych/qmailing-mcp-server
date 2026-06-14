import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { QmailingClient } from '../client.js';

interface MailboxDto {
  id: string;
  address: string;
  localPart: string;
  domain: string;
  displayName?: string | null;
  forwardTo?: string | null;
  forwardOnly?: boolean;
  status: string;
  emailCount: number;
  unreadCount: number;
  sizeBytes: number;
  createdAt: string;
}

/**
 * Tool: list every mailbox bound to the authenticated user. Mirrors
 * {@code GET /api/v1/pub/mailboxes}. Scope: {@code mailboxes:read}.
 *
 * <p>The LLM-facing description leans into "what can I do with this?"
 * over field-by-field schema docs — the JSON schema below already
 * surfaces field names, so the description should answer "when do I
 * pick this tool?" instead.
 */
export const listMailboxesTool: Tool = {
  name: 'qmailing_list_mailboxes',
  // Anthropic Connectors Directory requires `title` + read/write hint
  // on every tool (see qmailing/mcp/src/tools/domains.ts for the
  // rationale). Read-only.
  title: 'List mailboxes',
  description:
    'List all mailboxes belonging to the authenticated qmailing account. ' +
    'Use when the user asks "what mailboxes do I have?", needs a mailbox id ' +
    'before another action, or wants a quick inbox-volume overview ' +
    '(emailCount / unreadCount / sizeBytes are populated).',
  annotations: {
    title: 'List mailboxes',
    readOnlyHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

export async function handleListMailboxes(client: QmailingClient): Promise<MailboxDto[]> {
  return client.get<MailboxDto[]>('/api/v1/pub/mailboxes');
}

export const getMailboxTool: Tool = {
  name: 'qmailing_get_mailbox',
  title: 'Get mailbox by ID',
  description:
    'Fetch a single mailbox by its UUID. Returns the same fields as ' +
    'qmailing_list_mailboxes for one row. Use when the user references ' +
    'a specific mailbox and you already know its id (e.g. from a prior list).',
  annotations: {
    title: 'Get mailbox by ID',
    readOnlyHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The mailbox UUID. Get one from qmailing_list_mailboxes if you do not have it.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },
};

export async function handleGetMailbox(
  client: QmailingClient, args: { id: string },
): Promise<MailboxDto> {
  return client.get<MailboxDto>(`/api/v1/pub/mailboxes/${encodeURIComponent(args.id)}`);
}

export const createMailboxTool: Tool = {
  name: 'qmailing_create_mailbox',
  title: 'Create a mailbox',
  description:
    'Create a new mailbox under qmailing.com or one of the user\'s verified ' +
    'custom domains. Counts against the plan\'s mailbox quota; on a custom ' +
    'domain that domain must be both claimed AND fully DNS-verified or the ' +
    'API will return 400. Use when the user explicitly asks to "create" / ' +
    '"add" / "make" a mailbox; do NOT call this just to look one up.',
  // Destructive: creates a billable resource that counts against the
  // plan quota. Idempotent=false — calling twice with the same args
  // returns 409 the second time (local_part uniqueness).
  annotations: {
    title: 'Create a mailbox',
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      localPart: {
        type: 'string',
        description: 'The part before the @. Letters, digits, dots, hyphens, underscores; 1-64 chars.',
        minLength: 1,
        maxLength: 64,
      },
      domain: {
        type: 'string',
        description:
          'Domain part (e.g. "qmailing.com" or a verified custom domain). Optional; ' +
          'defaults to qmailing.com on the server side.',
      },
      displayName: {
        type: 'string',
        description: 'Friendly name on outbound mail (the part shown before <addr> in From).',
        maxLength: 255,
      },
      forwardTo: {
        type: 'string',
        description: 'Forward inbound mail to this address. Leave empty to keep the mailbox standalone.',
        maxLength: 320,
      },
    },
    required: ['localPart'],
    additionalProperties: false,
  },
};

export async function handleCreateMailbox(
  client: QmailingClient,
  args: { localPart: string; domain?: string; displayName?: string; forwardTo?: string },
): Promise<MailboxDto> {
  return client.post<MailboxDto>('/api/v1/pub/mailboxes', {
    localPart: args.localPart,
    domain: args.domain,
    displayName: args.displayName,
    forwardTo: args.forwardTo,
  });
}
