// EVERY SECRET-ENTRY FIELD WEARS THE ONE OPT-OUT SET (D-8404).
//
// Browsers and password managers offered saved logins in Settings' "Add a workspace: its Linear API key" field: a
// masked field with `autocomplete="off"` alone is still a login slot to them. `SECRET_INPUT` (`src/lib/secretInput.ts`)
// is the one set of attributes that says otherwise, and this file holds which fields spread it.
//
// - SECRET_FIELDS: the files with a field where a key, token or sign-in code is pasted. Each spreads `SECRET_INPUT`,
//   and nothing else does (held exactly, so a new secret field is named here or red).
// - PASSPHRASE_FIELDS: the console's own passphrase (sign-in and the step-up). A password manager filling it is the
//   point, so they keep `current-password` and never spread the set.
// - Any other file with a masked input is red until it is one of the two.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { SECRET_INPUT } from '../src/lib/secretInput';

const SRC = path.join(import.meta.dirname, '..', 'src');

const SECRET_FIELDS = [
  'accounts/CodeField.tsx',
  'accounts/SecretField.tsx',
  'ledgers/ItemView.tsx',
  'screens/LinearSection.tsx',
] as const;

const PASSPHRASE_FIELDS = [
  'accounts/ConfirmItsYou.tsx',
  'components/LoginScreen.tsx',
] as const;

const sources = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const e of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.tsx')) continue;
    const abs = path.join(e.parentPath, e.name);
    out.set(path.relative(SRC, abs).split(path.sep).join('/'), readFileSync(abs, 'utf8'));
  }
  return out;
};

describe('secret-entry fields (D-8404)', () => {
  it('the set turns off autocomplete, capitalisation, correction and spellcheck, and opts out of four password managers', () => {
    expect(SECRET_INPUT).toEqual({
      autoComplete: 'off',
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
      'data-1p-ignore': 'true',
      'data-lpignore': 'true',
      'data-bwignore': 'true',
      'data-form-type': 'other',
    });
    // Never `new-password`: that invites a manager to generate one.
    expect(Object.values(SECRET_INPUT)).not.toContain('new-password');
  });

  it('every secret field spreads the set, and nothing else does', () => {
    const src = sources();
    const spreading = [...src].filter(([, s]) => s.includes('{...SECRET_INPUT}')).map(([f]) => f).sort();
    expect(spreading).toEqual([...SECRET_FIELDS]);
  });

  it('a masked input is a secret field or the console passphrase; the passphrase alone is current-password', () => {
    const src = sources();
    const masked = [...src].filter(([, s]) => /type="password"|'password'/.test(s)).map(([f]) => f);
    const known = new Set<string>([...SECRET_FIELDS, ...PASSPHRASE_FIELDS]);
    expect(masked.filter((f) => !known.has(f))).toEqual([]);
    const current = [...src].filter(([, s]) => s.includes('current-password')).map(([f]) => f).sort();
    expect(current).toEqual([...PASSPHRASE_FIELDS]);
    for (const f of SECRET_FIELDS) expect(src.get(f), f).not.toMatch(/autoComplete=/);
  });
});
