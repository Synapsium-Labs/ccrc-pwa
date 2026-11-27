import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// X2 P4.4: a deliberately literal scan, not a deny list for entered rules. It sees provider domains, tenant and
// self-hosted tracker links with the usual issue paths, and an HTTP(S) template with a capture written in-line.
// It cannot identify an arbitrary self-hosted origin with no tracker-shaped path or a URL assembled in code.
const ADDRESS = /https?:\/\/[a-z0-9][^\s'"`<>\\]+/gi;
const PROVIDER = /(?:^|\.)(?:atlassian\.net|linear\.app|youtrack\.cloud)$/i;
const TRACKER_PATH = /\/(?:browse|issues?|tickets?)\/(?:[A-Za-z][A-Za-z0-9_]*-\d+|\{[0-9]\})\b|\/browse\/(?:[?#]|$)/i;
const CAPTURE = /\{[0-9]\}/;
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|css|json)$/i;

// The two service-wide origins belong to the existing Linear integration, not the Docs reader or any tenant.
// Exempt each exact declaration only in its owner; a copy or changed origin is still scanned.
const SERVICE_ORIGINS = new Map([
  ['server/src/linear/client.ts', ['LINEAR_API_ORIGIN', ['api', 'linear', 'app'].join('.')]],
  ['server/src/linear/ops.ts', ['LINEAR_WEB_ORIGIN', ['linear', 'app'].join('.')]],
]);

export function containsTrackerAddress(text: string, relativePath = ''): boolean {
  const allowed = SERVICE_ORIGINS.get(relativePath);
  if (allowed !== undefined) text = text.replace(`export const ${allowed[0]} = 'https://${allowed[1]}';`, '');
  for (const [address] of text.matchAll(ADDRESS)) {
    let parsed: URL;
    try { parsed = new URL(address); } catch { continue; }
    if (PROVIDER.test(parsed.hostname) || TRACKER_PATH.test(address) || CAPTURE.test(address)) return true;
  }
  return false;
}

/** Names only, never the URL. The caller chooses roots; the first component of a path can be excluded (e.g. fixtures). */
export function trackerAddressFiles(root: string, dirs: readonly string[], skip: (relativePath: string) => boolean = () => false): string[] {
  const hits: string[] = [];
  for (const dir of dirs) {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !TEXT_FILE.test(entry.name)) continue;
      const filename = path.join(entry.parentPath, entry.name);
      const relativePath = path.relative(root, filename).split(path.sep).join('/');
      if (!skip(relativePath) && containsTrackerAddress(readFileSync(filename, 'utf8'), relativePath)) hits.push(relativePath);
    }
  }
  return hits.sort();
}
