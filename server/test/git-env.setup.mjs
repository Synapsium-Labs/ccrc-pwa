// `setupFiles` entry and `globalSetup` module in one: scrubs git's repository-redirecting variables from this
// process's environment; see scrub-git-env.mjs. As a globalSetup it runs in the vitest MAIN process before the other
// global setups spawn anything, and workers inherit that environment at fork; as a setup file it repeats the scrub
// in each worker, so a pool that hands workers their own copy of the parent's environment is covered too.
import { scrubGitEnv } from './scrub-git-env.mjs';

scrubGitEnv();

export default function setup() {}
