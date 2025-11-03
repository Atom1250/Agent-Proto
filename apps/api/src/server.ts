import Fastify from 'fastify';
type HealthResponse = { status: 'ok' };
import { sessionsRoutes } from './routes/v1/sessions';
import { adminRoutes } from './routes/v1/admin';
import { realtimeRoutes } from './routes/v1/realtime';

const port = Number(process.env.API_PORT ?? 3001);
const host = process.env.API_HOST ?? '0.0.0.0';

async function buildServer() {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'production'
      ? true
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' }
          }
        }
  });

  app.get('/health', async (): Promise<HealthResponse> => {
    return { status: 'ok' };
  });

  app.setErrorHandler((error, _req, reply) => {
    app.log.error({ err: error }, 'unhandled error');
    const status = (error as any)?.statusCode ?? 500;
    reply.code(status).send({ error: status >= 500 ? 'internal_error' : error.message });
  });

  app.register(async (v1) => {
    await sessionsRoutes(v1);
    await adminRoutes(v1);
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

