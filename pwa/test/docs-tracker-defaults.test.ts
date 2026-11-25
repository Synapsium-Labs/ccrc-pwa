// X2 P4.4, M11.23. This half runs in the package that actually installs the reader library; the server suite
// scans the three shipped source roots with the same scanner without requiring a second npm installation.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { trackerAddressFiles } from '../../server/test/single-definition/docsTrackerHostScan';

const pwaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (filename: string): unknown => JSON.parse(readFileSync(filename, 'utf8'));

it('no tracker host ships in the pinned reader library defaults', () => {
  const lock = readJson(path.join(pwaRoot, 'package-lock.json')) as { packages: Record<string, { version?: string }> };
  // The package's rename is an independent pin wave. Pick whichever single reader the lock actually pins.
  const pins = Object.entries(lock.packages).filter(([name]) => /^node_modules\/@synapsium-labs\/(?:docserver|pinax-lib)$/.test(name));
  expect(pins.map(([name]) => name), 'exactly one reader pin').toHaveLength(1);
  const [name, pin] = pins[0]!;
  const reader = path.join(pwaRoot, name);
  const installed = readJson(path.join(reader, 'package.json')) as { version?: string };
  expect(installed.version).toBeTypeOf('string');
  expect(installed.version).toBe(pin.version);
  expect(trackerAddressFiles(reader, ['dist', 'assets'], (f) => f.startsWith('dist/conformance/'))).toEqual([]);
});
