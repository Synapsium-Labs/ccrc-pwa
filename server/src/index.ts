import { buildServer } from './server.js';

const app = await buildServer();
const host = process.env.CCRC_HOST ?? '127.0.0.1';
const port = Number(process.env.CCRC_PORT ?? 7788);
await app.listen({ host, port });
console.log(`ccrc-server on ${host}:${port}`);
