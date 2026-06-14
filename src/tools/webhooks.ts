import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { QmailingClient } from '../client.js';

interface WebhookEndpointSummary {
  id: string;
  url: string;
  label: string;
  secretPrefix: string;
  events: string[];
  enabled: boolean;
  lastDeliveredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

interface IssuedWebhook {
  endpoint: WebhookEndpointSummary;
  /** The signing secret. Shown ONCE — the agent must persist it locally if needed. */
  plaintext: string;
}

export const registerWebhookTool: Tool = {
  name: 'qmailing_register_webhook',
  // Anthropic Connectors Directory requires `title` + read/write hint
  // on every tool (see qmailing/mcp/src/tools/domains.ts for the
  // rationale). Destructive: issues a one-time secret + persists a
  // billable subscription row.
  title: 'Register a webhook endpoint',
  description:
    'Register an HTTPS endpoint that qmailing will POST to when ' +
    'specific events fire (email.received, email.sent, email.bounced, ' +
    'domain.verified). Returns a signing secret in `plaintext` ONCE — ' +
    'persist it client-side; it is never retrievable after this call. ' +
    'Future delivery code will sign each POST with HMAC over this secret.',
  annotations: {
    title: 'Register a webhook endpoint',
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'HTTPS URL where qmailing should POST event payloads. http:// is also accepted but discouraged.' },
      label: { type: 'string', description: 'Human-readable label so the developer UI can tell endpoints apart.' },
      events: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        description: 'Subscribed events. Use "*" to subscribe to every event the platform emits.',
      },
    },
    required: ['url', 'label', 'events'],
    additionalProperties: false,
  },
};

export async function handleRegisterWebhook(
  client: QmailingClient,
  args: { url: string; label: string; events: string[] },
): Promise<IssuedWebhook> {
  return client.post<IssuedWebhook>('/api/v1/pub/webhooks', args);
}

export const listWebhooksTool: Tool = {
  name: 'qmailing_list_webhooks',
  title: 'List webhook endpoints',
  description:
    'List the calling account\'s webhook endpoints (active and revoked). ' +
    'Use to inspect existing subscriptions before registering a duplicate, ' +
    'or to find an id to revoke.',
  annotations: {
    title: 'List webhook endpoints',
    readOnlyHint: true,
    openWorldHint: true,
  },
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

export async function handleListWebhooks(client: QmailingClient): Promise<WebhookEndpointSummary[]> {
  return client.get<WebhookEndpointSummary[]>('/api/v1/pub/webhooks');
}

export const deleteWebhookTool: Tool = {
  name: 'qmailing_delete_webhook',
  title: 'Delete a webhook endpoint',
  description:
    'Revoke a webhook endpoint by id. Idempotent — already-revoked ' +
    'endpoints succeed silently so retries are safe.',
  // Destructive: revokes a subscription. Idempotent — second call
  // returns 204 silently per handleDeleteWebhook below.
  annotations: {
    title: 'Delete a webhook endpoint',
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Webhook endpoint UUID.' },
    },
    required: ['id'],
    additionalProperties: false,
  },
};

export async function handleDeleteWebhook(
  client: QmailingClient, args: { id: string },
): Promise<void> {
  await client.delete(`/api/v1/pub/webhooks/${encodeURIComponent(args.id)}`);
}
