// D-5896 (ARCH-05, #551): the pure half of `config.ts`. `config.ts` reads files and imports `coord/db.ts` for its
// default paths, so a reader that only wanted a wrapper's config dir loaded `node:sqlite`. `config.ts` re-exports
// this. The import below is a type and is elided.
import path from 'node:path';
import type { CcrcConfig } from './config.js';

/**
 * THE ONE place a wrapper becomes a directory — every other reader of an
 * account's config dir (`fleet.ts`, `server.ts`, `commands.ts`, `watch.ts`,
 * `sessionws.ts`) calls this instead of indexing `cfg.roster.byId` directly
 * by wrapper name (`single-definition.test.ts` enforces it). `undefined` for
 * any id the roster does not have — a `SessionRecord.wrapper` read off disk
 * is an untrusted string (a stale build, a hand-edited registry file, or the
 * `'ghost-wrapper'` fixture `pr-sweep.test.ts` writes on purpose), and the
 * whole point of this function existing is that callers get one `undefined`
 * to check rather than a bare index into a map that might not have the key.
 *
 * The lookup is DATA, not a hand-typed table, and that is load-bearing: the
 * account roster's 5th member (`claude-dev0`) was once missing from a
 * hand-typed sibling of this map for its entire life (see this file's git
 * history), because that map used to be a second literal kept BESIDE the
 * roster instead of derived FROM it. Going through `cfg.roster.byId` — built
 * once, by `loadConfig`, straight from `~/.ccrc/accounts.json` — closes that
 * class of bug structurally: an account added to the roster gets a config
 * dir here with no second edit, and none can be silently skipped the way a
 * hand-typed table could be.
 */
export function configDirFor(cfg: CcrcConfig, wrapper: string): string | undefined {
  const account = cfg.roster.byId.get(wrapper);
  return account ? path.join(cfg.home, account.configDirSuffix) : undefined;
}
