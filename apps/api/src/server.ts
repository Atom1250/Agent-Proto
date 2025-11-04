import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';
type HealthResponse = { status: 'ok' };
import { getMetricsSnapshot, metricsContentType } from './lib/metrics';
import { sessionsRoutes } from './routes/v1/sessions';
import { adminRoutes } from './routes/v1/admin';
import { realtimeRoutes } from './routes/v1/realtime';

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

async function buildServer() {
  const redactPaths = [
    'req.headers.authorization',
    'req.headers.cookie',
    '*.authorization',
    '*.token',
    '*.secret',
    '*.apiKey',
    '*.api_key',
    '*.id',
    '*.Id',
    '*.ID',
    '*.sessionId',
    '*.clientId',
    '*.templateId',
    '*.attachmentId',
    '*.eventId',
    'req.body.content',
    '*.message.content',
  ];

  const isProduction = process.env.NODE_ENV === 'production';
  const logger = isProduction
    ? {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: { paths: redactPaths, censor: '[Redacted]' },
      }
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
        redact: { paths: redactPaths, censor: '[Redacted]' },
      };

  const trustProxy = (() => {
    const raw = process.env.TRUST_PROXY;
    if (!raw) {
      return true;
    }

    const normalized = raw.trim().toLowerCase();
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }

    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      return numeric;
    }

    return raw;
  })();

  const app = Fastify({
    logger,
    trustProxy,
    genReqId(request) {
      const header = request.headers['x-request-id'];
      const incoming = Array.isArray(header) ? header[0] : header;
      const provided = typeof incoming === 'string' ? incoming.trim() : '';
      return provided || randomUUID();
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  });

  app.addHook('onRequest', async (req, reply) => {
    const traceHeader = req.headers['x-trace-id'];
    const incoming = Array.isArray(traceHeader) ? traceHeader[0] : traceHeader;
    const traceId = typeof incoming === 'string' && incoming.trim() ? incoming.trim() : randomUUID();
    reply.header('x-request-id', req.id);
    reply.header('x-trace-id', traceId);
    (req as any).traceId = traceId;
    req.log = req.log.child({ requestId: req.id, traceId });
  });

  const allowedOrigin = process.env.WEB_APP_ORIGIN ?? 'http://localhost:3000';
  const createCorsError = () => {
    const err = new Error('origin_not_allowed');
    (err as any).statusCode = 403;
    return err;
  };

  app.options('*', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin !== allowedOrigin) {
      reply.code(403);
      return reply.send({ error: 'origin_not_allowed' });
    }

    const allowHeaders = req.headers['access-control-request-headers'] ?? 'content-type,authorization,x-admin-secret';
    const allowMethod = req.headers['access-control-request-method'] ?? 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

    reply
      .header('Access-Control-Allow-Origin', allowedOrigin)
      .header('Access-Control-Allow-Credentials', 'true')
      .header('Access-Control-Allow-Headers', allowHeaders)
      .header('Access-Control-Allow-Methods', allowMethod)
      .header('Vary', 'Origin')
      .code(204);

    return reply.send();
  });

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin) {
      if (origin !== allowedOrigin) {
        req.log.warn({ origin }, 'blocked request due to disallowed origin');
        throw createCorsError();
      }
      reply.header('Access-Control-Allow-Origin', allowedOrigin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Vary', 'Origin');
    }
  });

  const rateLimitWindowMs = (() => {
    const raw = process.env.RATE_LIMIT_WINDOW_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
  })();

  const rateLimitMax = (() => {
    const raw = process.env.RATE_LIMIT_MAX ?? '120';
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 120;
  })();

  const rateBucketMaxEntries = (() => {
    const raw = process.env.RATE_LIMIT_MAX_BUCKETS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10_000;
  })();

  type RateState = { count: number; resetAt: number };
  const rateBuckets = new Map<string, RateState>();
  let lastRateBucketSweep = 0;

  app.addHook('onRequest', async (req, reply) => {
    const url = req.raw.url ?? '';
    if (url.startsWith('/v1/admin')) {
      return;
    }

    const now = Date.now();
    if (now - lastRateBucketSweep > rateLimitWindowMs) {
      for (const [key, state] of rateBuckets) {
        if (state.resetAt <= now) {
          rateBuckets.delete(key);
        }
      }
      lastRateBucketSweep = now;
    }

    while (rateBuckets.size > rateBucketMaxEntries) {
      let oldestKey: string | undefined;
      let oldestReset = Infinity;
      for (const [key, state] of rateBuckets) {
        if (state.resetAt < oldestReset) {
          oldestReset = state.resetAt;
          oldestKey = key;
        }
      }
      if (!oldestKey) {
        break;
      }
      rateBuckets.delete(oldestKey);
    }

    const forwarded = req.headers['x-forwarded-for'];
    let forwardedIp: string | null = null;
    if (Array.isArray(forwarded)) {
      forwardedIp = forwarded[0] ?? null;
    } else if (typeof forwarded === 'string') {
      forwardedIp = forwarded;
    }

    const key = forwardedIp?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || 'anonymous';
    const existing = rateBuckets.get(key);

    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
      reply.header('X-RateLimit-Limit', String(rateLimitMax));
      reply.header('X-RateLimit-Remaining', String(Math.max(rateLimitMax - 1, 0)));
      reply.header('X-RateLimit-Reset', String(Math.floor((now + rateLimitWindowMs) / 1000)));
      return;
    }

    existing.count += 1;
    const remaining = Math.max(rateLimitMax - existing.count, 0);
    reply.header('X-RateLimit-Limit', String(rateLimitMax));
    reply.header('X-RateLimit-Remaining', String(remaining));
    reply.header('X-RateLimit-Reset', String(Math.floor(existing.resetAt / 1000)));

    if (existing.count > rateLimitMax) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      reply
        .code(429)
        .header('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      const rateLimitError = new Error('rate_limit_exceeded');
      (rateLimitError as any).statusCode = 429;
      throw rateLimitError;
    }
  });

  app.get('/health', async (): Promise<HealthResponse> => {
    return { status: 'ok' };
  });

  app.setErrorHandler((error, _req, reply) => {
    const status = (error as any)?.statusCode ?? (error.message === 'rate_limit_exceeded' ? 429 : 500);
    if (status >= 500) {
      app.log.error({ err: error }, 'request failed');
    } else if (status >= 400) {
      app.log.warn({ err: error }, 'request failed');
    } else {
      app.log.info({ err: error }, 'request failed');
    }
    if (status === 429 && !reply.hasHeader('Retry-After')) {
      reply.header('Retry-After', '60');
    }
    reply.code(status).send({ error: status >= 500 ? 'internal_error' : error.message });
  });

  app.register(async (v1) => {
    v1.get('/metrics', async (_req, reply) => {
      const payload = getMetricsSnapshot();
      reply.header('Content-Type', metricsContentType);
      reply.header('Cache-Control', 'no-store');
      return reply.send(payload);
    });

    await sessionsRoutes(v1);
    await v1.register(adminRoutes, { prefix: '/admin' });
    await realtimeRoutes(v1);
  }, { prefix: '/v1' });

  return app;
}

async function start() {
  const app = await buildServer();
  try {
    await app.listen({ port, host });
    app.log.info(`API listening on http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();

