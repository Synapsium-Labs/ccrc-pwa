// What the server holds (Overlord W1, plan `w1-isolation.md` Task 3, question 11, ruled F3): one list from `CcrcConfig`,
// every path field classified, every environment override honoured, and the unit and environment file names held equal to
// `ccd/ccrc`'s spellings.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  NOT_HELD, SERVER_ENV_FILE, SERVER_EXPOSURE_FILE, SERVER_UNIT_DIR_DARWIN, SERVER_UNIT_DIR_LINUX, SERVER_UNIT_NAME, serverHoldings,
} from '../src/isolationFacts.js';
import { seedRoster } from './helpers.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();
const CCRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'ccd', 'ccrc');
const PATH_FIELD = /(Path|Dir|Root|Bin)$/;
const box = (): string => { const home = mkTmp('ccrc-holdings-'); seedRoster(home); return home; };

describe('serverHoldings', () => {
  it('every CcrcConfig field ending Path, Dir, Root or Bin is held or named with its reason', () => {
    const home = box();
    const cfg = loadConfig({ CCRC_HOME: home });
    const held = new Set(serverHoldings(cfg, '/code', {}).map((h) => h.name));
    const fields = Object.keys(cfg).filter((k) => PATH_FIELD.test(k)).sort();
    expect(fields.length).toBeGreaterThan(10);
    const unclassified = fields.filter((k) => !held.has(k) && !(k in NOT_HELD));
    expect(unclassified).toEqual([]);
    // Nothing is both held and excused, and every excuse names a real field and gives a reason.
    for (const k of Object.keys(NOT_HELD)) {
      expect(held.has(k), k).toBe(false);
      expect(fields, k).toContain(k);
      expect(NOT_HELD[k]!.length, k).toBeGreaterThan(10);
    }
  });

  it('holds the secret stores, the code tree, the unit and both environment files', () => {
    const home = box();
    const list = serverHoldings(loadConfig({ CCRC_HOME: home }), '/code', {}, 'linux');
    const by = Object.fromEntries(list.map((h) => [h.name, h]));
    for (const n of ['ccrcDir', 'coordDbPath', 'operatorModelDbPath', 'mailTokenPath', 'authSecretPath', 'sessionsPath', 'passkeysPath', 'accountsPath']) {
      expect(by[n]?.concern, n).toBe('secret');
    }
    expect(by.ccrcDir!.path).toBe(path.join(home, '.ccrc'));
    expect(by.codeRoot).toEqual({ name: 'codeRoot', path: '/code', concern: 'control' });
    expect(by.unit!.path).toBe(path.join(home, '.config/systemd/user/ccrc.service'));
    expect(by.unitDropIns!.path).toBe(path.join(home, '.config/systemd/user/ccrc.service.d'));
    expect(by.envFile!.path).toBe(path.join(home, '.ccrc/ccrc.env'));
    expect(by.exposureFile!.path).toBe(path.join(home, '.ccrc/exposure.env'));
    expect(serverHoldings(loadConfig({ CCRC_HOME: home }), '/code', {}, 'darwin').find((h) => h.name === 'unit')!.path)
      .toBe(path.join(home, 'Library/LaunchAgents'));
  });

  it('each environment override moves its path', () => {
    const home = box();
    const env = {
      CCRC_HOME: home, CCRC_COORD_DB: '/s/coord.db', CCRC_MAIL_TOKEN_PATH: '/s/mail.token', CCRC_AUTH_SECRET_PATH: '/s/auth',
      CCRC_SESSIONS_PATH: '/s/sessions', CCRC_PASSKEYS_PATH: '/s/passkeys', CCRC_ACCOUNTS: path.join(box(), '.ccrc', 'accounts.json'),
    };
    const by = Object.fromEntries(serverHoldings(loadConfig(env), '/code', { CCRC_EXPOSURE_FILE: '/s/exposure.env' }).map((h) => [h.name, h.path]));
    expect([by.coordDbPath, by.mailTokenPath, by.authSecretPath, by.sessionsPath, by.passkeysPath, by.accountsPath, by.exposureFile])
      .toEqual(['/s/coord.db', '/s/mail.token', '/s/auth', '/s/sessions', '/s/passkeys', env.CCRC_ACCOUNTS, '/s/exposure.env']);
  });

  it("the unit, the unit directory and the two environment files are ccd/ccrc's spellings", () => {
    const text = readFileSync(CCRC, 'utf8');
    expect(text).toContain(`local role_unit=${SERVER_UNIT_NAME}\n`);
    expect(text).toContain(`BOX_UNIT_DIR="$HOME/${SERVER_UNIT_DIR_LINUX}"`);
    expect(text).toContain(`BOX_UNIT_DIR="$HOME/${SERVER_UNIT_DIR_DARWIN}"`);
    expect(text).toContain(`BOX_ENV_FILE="$HOME/${SERVER_ENV_FILE}"`);
    expect(text).toContain(`CCRC_EXPOSURE_FILE="$HOME/${SERVER_EXPOSURE_FILE}"`);
  });
});
