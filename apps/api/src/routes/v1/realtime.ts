import type { FastifyInstance } from 'fastify';

type EphemeralTokenSuccessResponse = {
  token: string;
  expiresAt: string;
  model: string;
};

type EphemeralTokenErrorResponse = {
  error: 'service_unavailable' | 'upstream_failure';
};

type OpenAIRealtimeSessionResponse = {
  client_secret?: {
    value?: string;
    expires_at?: number;
  };
};

const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-realtime-preview-2024-12-17';

export async function realtimeRoutes(app: FastifyInstance) {
  app.post<{ Reply: EphemeralTokenSuccessResponse | EphemeralTokenErrorResponse }>('/realtime/ephemeral', async (req, reply) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      req.log.error('OPENAI_API_KEY is not configured');
      reply.code(500).send({ error: 'service_unavailable' });
      return;
    }

    try {
      const upstreamResponse = await fetch('https://api.openai.com/v1/realtime/sessions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Beta': 'realtime=v1',
        },
        body: JSON.stringify({ model: OPENAI_REALTIME_MODEL }),
      });

      if (!upstreamResponse.ok) {
        req.log.error(
          { status: upstreamResponse.status, statusText: upstreamResponse.statusText },
          'failed to create realtime session'
        );
        reply.code(502).send({ error: 'upstream_failure' });
        return;
      }

      const payload = (await upstreamResponse.json()) as OpenAIRealtimeSessionResponse;
      const token = payload.client_secret?.value;
      const expiresAt = payload.client_secret?.expires_at;

      if (!token || !expiresAt) {
        req.log.error('realtime session response missing client secret');
        reply.code(502).send({ error: 'upstream_failure' });
        return;
      }

      reply.send({ token, expiresAt: new Date(expiresAt * 1000).toISOString(), model: OPENAI_REALTIME_MODEL });
    } catch (error) {
      req.log.error({ err: error }, 'error creating realtime session');
      reply.code(502).send({ error: 'upstream_failure' });
    }
  });
}
