import { startAgent } from './server.js';

const token = process.env.CCRC_AGENT_TOKEN;
if (!token) {
  console.error('ccrc-agent: CCRC_AGENT_TOKEN is required');
  process.exit(1);
}

const agent = await startAgent({
  host: process.env.CCRC_AGENT_HOST,
  port: process.env.CCRC_AGENT_PORT ? Number(process.env.CCRC_AGENT_PORT) : undefined,
  token,
});

console.log(`ccrc-agent on ${process.env.CCRC_AGENT_HOST ?? '127.0.0.1'}:${agent.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void agent.close().finally(() => process.exit(0));
  });
}
