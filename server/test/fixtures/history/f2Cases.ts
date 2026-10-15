// server/test/fixtures/history/f2Cases.ts — TEST-ONLY. The redaction value classes as the field pass has them (W1-B2 fix round 1,
// D-5021, coordinator ruling 5020), shared by history-lib (j3), history-cli (H-32) and history-maint (the relay), so all three
// run the same table through redactFinalLines, errLine and the relay.

/** One input of the F2 table: a secret value that holds one of the five characters the final form's classes stop at
 *  (< > & " and a backslash), or one more character a class ends at, in one of the forms the field pass reads.
 *  `whole` says the form's value class admits that character (so the whole value is masked); false says the class ENDS at it
 *  (B1's shared rule, unchanged from the base: `password=abc&def` prints `password=[redacted]&def`), and the pin is then that
 *  redactFinalLines equals redactField on the input, which keeps the field pass the guard (the value there opens with `<`,
 *  which the final form's own class stops at, so the final form alone prints something else).
 *  `viaStream` is false for a character that cannot ride a line of a stand-in shim or an environment variable (CR, U+2028).
 *  `runs` are the pieces of the value that must not print when `whole`. */
export interface F2Case { form: string; char: string; input: string; whole: boolean; viaStream: boolean; runs: string[] }

const F2_FORMS: Array<{ form: string; make: (v: string) => string; endsAt: string[] }> = [
  { form: 'json', make: (v) => `{"password": "${v}"}`, endsAt: [] },
  { form: 'json box-token', make: (v) => `{"x-ccrc-mail-token": "${v}"}`, endsAt: [] },
  { form: 'bearer', make: (v) => `Authorization: Bearer ${v}`, endsAt: ['"', '\r', ' '] },
  { form: 'named', make: (v) => `password=${v}`, endsAt: ['&', '"', ';', ',', '`', '\r', ' '] },
  { form: 'box-token header', make: (v) => `x-ccrc-mail-token: ${v}`, endsAt: ['"', '\r', ' '] },
];
export const F2_CHARS = ['<', '>', '&', '"', '\\'] as const;

export function f2Cases(): F2Case[] {
  const out: F2Case[] = [];
  for (const f of F2_FORMS) {
    const inJson = f.form.startsWith('json');
    for (const c of F2_CHARS) {
      // inside a JSON string the double quote is escaped, as JSON writes it
      const lit = inJson && c === '"' ? '\\"' : c;
      const whole = !f.endsAt.includes(c);
      out.push({ form: f.form, char: c, input: f.make(whole ? `ab${lit}cdXQ9` : `a<b${lit}cdXQ9`), whole, viaStream: true, runs: whole ? ['cdXQ9'] : [] });
    }
    // the characters a class ends at that the five do not name (`;` `,` a backtick, CR, U+2028)
    for (const c of f.endsAt.filter((e) => !(F2_CHARS as readonly string[]).includes(e))) {
      out.push({ form: f.form, char: c, input: f.make(`a<b${c}cdXQ9`), whole: false, viaStream: c !== '\r' && c !== ' ', runs: [] });
    }
  }
  return out;
}
