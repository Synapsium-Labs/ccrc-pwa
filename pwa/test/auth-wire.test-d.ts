// Stage 3a Task 1 — the auth wire vocabulary, seen from the OTHER side.
//
// `server/test/auth-wire.test.ts` proves the shapes under the server's
// `NodeNext` resolution. This file proves the same declarations reach the PWA,
// which resolves modules completely differently (`moduleResolution: bundler`,
// extensionless, `verbatimModuleSyntax`) — the half of "declared once, imported
// by both sides" that a server-only test cannot see at all. It is a type-level
// suite because there is nothing to run: `vite.config.ts` sets
// `test.typecheck.enabled`, so a shape that stopped being importable here is a
// RED TEST in `vitest run`, not a `tsc --noEmit` a reader might skip (the
// `sheet.test-d.tsx` precedent, for its reason).
import { expectTypeOf, test } from 'vitest';
import {
  AUTH_VERDICTS, isAuthVerdict,
  type AuthStatus, type AuthVerdict, type LoginRequest,
  type PasskeyAssertFinish, type PasskeyAssertStart,
  type PasskeyRegisterFinish, type PasskeyRegisterStart,
} from '../../shared/api';

test('the verdict union and its predicate are the PWA’s too', () => {
  expectTypeOf(AUTH_VERDICTS).toEqualTypeOf<readonly AuthVerdict[]>();
  // The predicate NARROWS here, which is the whole reason the PWA imports it
  // rather than comparing strings: a 401 body's `verdict` field arrives as
  // `unknown` and has to become an `AuthVerdict` before the login screen can
  // switch on it.
  expectTypeOf(isAuthVerdict).guards.toEqualTypeOf<AuthVerdict>();
  expectTypeOf<'unconfigured'>().toExtend<AuthVerdict>();
  expectTypeOf<'off'>().not.toExtend<AuthVerdict>();
});

test('the login screen’s two shapes', () => {
  expectTypeOf<LoginRequest>().toEqualTypeOf<{ passphrase: string }>();
  // A COUNT, not a boolean — the enroll surface renders the number.
  expectTypeOf<AuthStatus['passkeysEnrolled']>().toEqualTypeOf<number>();
  expectTypeOf<AuthStatus['mode']>().toEqualTypeOf<'off' | 'passphrase' | 'locked-out'>();
});

test('the passkey shapes the browser fills in', () => {
  // The PWA is the producer of both `Finish` shapes (it is the only thing that
  // can call `navigator.credentials`), so these being importable HERE is not
  // decoration — it is the compiler check on what it sends.
  expectTypeOf<PasskeyRegisterStart['challengeB64url']>().toEqualTypeOf<string>();
  expectTypeOf<PasskeyRegisterFinish['algorithm']>().toEqualTypeOf<number>();
  expectTypeOf<PasskeyAssertStart['allowCredentialIdsB64url']>().toEqualTypeOf<readonly string[]>();
  expectTypeOf<PasskeyAssertFinish['signatureB64url']>().toEqualTypeOf<string>();
});
