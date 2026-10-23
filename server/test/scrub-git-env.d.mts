export const GIT_LOCAL_ENV_FLOOR: string[];
export function isGitRedirectVar(name: string, extra?: readonly string[]): boolean;
export function scrubGitEnv(env?: NodeJS.ProcessEnv): string[];
