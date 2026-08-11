import { startAgent } from './server.js';

// Last-resort backstop: log and keep running rather than let Node's default
// behavior (terminate the process) turn any missed rejection anywhere in
// the agent into a fleet-wide outage. The dispatch path in server.ts is the
// real fix (validated request shapes + a `.catch` on every handler
// invocation) — this is defense in depth for whatever that misses.
process.on('unhandledRejection', (reason) => {
  console.error('ccrc-agent: unhandled rejection (ignored, process stays up):', reason);
});

const token = process.env.CCRC_AGENT_TOKEN;
if (!token) {
  console.error('ccrc-agent: CCRC_AGENT_TOKEN is required');
  process.exit(1);
}

const agent = await startAgent({
  host: process.env.CCRC_AGENT_HOST,
  port: process.env.CCRC_AGENT_PORT ? Number(process.env.CCRC_AGENT_PORT) : undefined,
  token,
  projectsRoot: process.env.CCRC_PROJECTS_ROOT,
});

console.log(`ccrc-agent on ${process.env.CCRC_AGENT_HOST ?? '127.0.0.1'}:${agent.port}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void agent.close().finally(() => process.exit(0));
  });
}
