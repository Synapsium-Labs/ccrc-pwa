// Prints the fan-out scanner's jq program as ccd/session-hook.sh holds it (argv[2]): the text between the opening quote of
// `fo=$(jq -r --arg file "$fosrc" '` and the quote that ends it before `<<<"$payload"`.
import fs from 'node:fs';
const s = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');
const open = 'fo=$(jq -r --arg file "$fosrc" \'\n';
const close = '\' <<<"$payload" 2>/dev/null) || fo=""';
const a = s.indexOf(open);
const b = s.indexOf(close, a);
if (a < 0 || b < 0) { process.stderr.write('the fan-out program was not found\n'); process.exit(1); }
process.stdout.write(s.slice(a + open.length, b));
