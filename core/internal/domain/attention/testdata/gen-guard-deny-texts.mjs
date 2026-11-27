// Writes the deny-file texts the forbidden program's `$ARGS.named.deny` parse is measured over (gen-guard-golden.sh):
// one JSON string a line, each a text the hook could pass as `--arg deny` (a missing or unreadable file passes none).
const P = (deny) => JSON.stringify({ permissions: { deny } });
const rows = [
  '', '{', 'null', '[]', '1', '"x"', '{}', '{"permissions":null}', '{"permissions":{"deny":null}}', '{"permissions":{"deny":"Bash(upx install:*)"}}',
  P(['Bash(upx install:*)', 'Bash(upx update:*)']), P(['Bash(upx install:*)']), P(['Bash(upx update:*)']),
  P(['Bash(upx install:*)', 'Bash(upx update:*)', 'Bash(x-y install:*)', 'Bash(x-y update:*)']),
  P(['Bash(claude install:*)', 'Bash(claude update:*)']), P(['Bash(Upx install:*)', 'Bash(Upx update:*)']),
  P(['Bash(upx install:*)\n', 'Bash(upx update:*)']), P(['Bash(upx install:*)\n\n', 'Bash(upx update:*)']),
  P(['Bash(upx install:*) ', 'Bash(upx update:*)']), P(['Bash(1upx install:*)', 'Bash(1upx update:*)']),
  P(['Bash(' + 'a'.repeat(32) + ' install:*)', 'Bash(' + 'a'.repeat(32) + ' update:*)']),
  P(['Bash(' + 'a'.repeat(33) + ' install:*)', 'Bash(' + 'a'.repeat(33) + ' update:*)']),
  P([1, 'Bash(upx install:*)', null, 'Bash(upx update:*)']), P(['Bash(upx install:*)', 'Bash(upx update:*)', 'Bash(upx install:*)']),
  P(['Bash(upx install:*)', 'Bash(upx update:*)']) + ' {}', P(['Bash(upx install:*)', 'Bash(upx update:*)']) + '\n',
  '{"permissions":{"deny":["Bash(upx install:*)","Bash(upx update:*)"]},"permissions":{"deny":[]}}',
  '{"permissions":{"deny":["Bash(upx install:*)","Bash(upx update:*)"]},"x":nan}',
  '{"permissions":{"deny":["Bash(upx install:*)","Bash(upx update:*)","Bash(é install:*)"]}}',
  '{"permissions":{"deny":["Bash(upx install:*)","Bash(upx update:*)"]}} trailing',
  '﻿' + P(['Bash(upx install:*)', 'Bash(upx update:*)']),
  ...['01', '+1', '.5', '1.', '-nan', 'NaN', 'Infinity', '-inf', '1e999', '0x1', '1e', 'nul', 'True', '.'].map((n) =>
    `{"permissions":{"deny":["Bash(upx install:*)",${n},"Bash(upx update:*)"]},"n":${n}}`),
  ' ' + P(['Bash(upx install:*)', 'Bash(upx update:*)']), '﻿﻿' + P(['Bash(upx install:*)', 'Bash(upx update:*)']),
  '{"permissions":{"deny":["Bash(upx install:*)","Bash(upx update:*)","\\ud800"]}}',
];
process.stdout.write(rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
