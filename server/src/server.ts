import Fastify, { type FastifyInstance } from 'fastify';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ ok: true }));
  return app;
}
