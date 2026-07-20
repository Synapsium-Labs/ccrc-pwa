import os from 'node:os';
import path from 'node:path';

export interface CcrcConfig {
  host: string;
  port: number;
  home: string;
  registryDir: string;
  limitsDir: string;
  clipsDir: string;
  uploadsDir: string;
  ccdBin: string;
  projectsRoot: string;
  wrappers: Record<string, string>;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CcrcConfig {
  const home = env.CCRC_HOME ?? os.homedir();
  return {
    host: env.CCRC_HOST ?? '127.0.0.1',
    port: Number(env.CCRC_PORT ?? 7788),
    home,
    registryDir: path.join(home, '.cc-sessions'),
    limitsDir: path.join(home, '.cc-limits'),
    clipsDir: path.join(home, '.cc-clips'),
    uploadsDir: path.join(home, '.cc-clips', 'uploads'),
    ccdBin: path.join(home, '.local', 'bin', 'ccd'),
    projectsRoot: env.CCRC_PROJECTS_ROOT ?? '/data/projects',
    wrappers: {
      claude: path.join(home, '.claude'),
      claude2: path.join(home, '.claude-personal'),
      'claude-corp': path.join(home, '.claude-corp'),
      gpt: path.join(home, '.claude-gpt'),
    },
  };
}
