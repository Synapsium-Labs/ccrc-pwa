// `itemPlainText` (shared/itemText.ts): item Markdown as one plain line for every summary surface.
import { describe, expect, it } from 'vitest';
import { itemPlainLines, itemPlainText } from '../../shared/itemText';

const p = itemPlainText;

describe('itemPlainText: what is removed', () => {
  it('a fenced block keeps its inner text; the fence lines and info string go', () => {
    expect(p('Run this:\n```sh\nccrc doctor\nccrc version\n```\nthen tell me')).toBe('Run this: ccrc doctor ccrc version then tell me');
    expect(p('~~~\nplain\n~~~')).toBe('plain');
    expect(p('````\n```\ninner\n```\n````')).toBe('``` inner ```');
  });
  it('inline code loses its backticks and keeps its content, double-backtick spans too', () => {
    expect(p('set `a` now')).toBe('set a now');
    expect(p('use ``a ` b`` here')).toBe('use a ` b here');
  });
  it('asterisk emphasis goes: one, two and three', () => {
    expect(p('*x* and **y** and ***z***')).toBe('x and y and z');
  });
  it('a full stop after a closing run ends the sentence, as the item page reads it', () => {
    expect(p('This is *important*. And **this**.')).toBe('This is important. And this.');
  });
  it('strikethrough goes under the same rule', () => {
    expect(p('~~old~~ new')).toBe('old new');
  });
  it('links keep their words, images their alt, autolinks their address', () => {
    expect(p('see [the spec](https://example.com/a_(b)) now')).toBe('see the spec now');
    expect(p('![diagram](img/a.png) shown')).toBe('diagram shown');
    expect(p('open <https://example.com/x> ok')).toBe('open https://example.com/x ok');
    expect(p('[**bold** `code`](x)')).toBe('bold code');
  });
  it('a backslash before punctuation stays as written, and makes no mark (fix round 1, A2)', () => {
    expect(p('\\*not\\* \\_u\\_ \\`t\\`')).toBe('\\*not\\* \\_u\\_ \\`t\\`');
    expect(p('match ccrc-[0-9]+\\.log only')).toBe('match ccrc-[0-9]+\\.log only');
  });
  it('a character reference stays as written (A2)', () => {
    expect(p('AT&amp;T and &lt;b&gt;')).toBe('AT&amp;T and &lt;b&gt;');
  });
  it('a mail address in angle brackets keeps its address, as the page draws it (F7)', () => {
    expect(p('write to <ops@example.com> now')).toBe('write to ops@example.com now');
  });
  it('a paragraph is read as one text: a code span or an emphasis across a soft line break is one mark (F7)', () => {
    expect(p('run `ccrc\ndoctor` now')).toBe('run ccrc doctor now');
    expect(p('an *emphasis\nacross lines* here')).toBe('an emphasis across lines here');
    expect(p('a `span\n\nthat breaks` here')).toBe('a `span that breaks` here');
  });
  it('a single tilde is no strikethrough (F7)', () => {
    expect(p('use ~old~ now')).toBe('use ~old~ now');
  });
  it('whitespace runs, newlines included, collapse to one space and the ends are trimmed', () => {
    expect(p('  a \n\n  b\t\tc \r\n d  ')).toBe('a b c d');
  });
});

describe('itemPlainText: what is kept as written', () => {
  it('an asterisk run whose outer side is a letter, a digit, a slash or a dot is no emphasis', () => {
    expect(p('src/*.ts and docs/*.md')).toBe('src/*.ts and docs/*.md');
    expect(p('5*3*2')).toBe('5*3*2');
    expect(p('a*b*c')).toBe('a*b*c');
    expect(p('v1.*x*')).toBe('v1.*x*');
    expect(p('~~x~~y')).toBe('~~x~~y');
  });
  it('a glob that ends a sentence stays as written, with a second glob after it on the line', () => {
    expect(p('Clear build/*. Then rebuild lib/* from scratch.')).toBe('Clear build/*. Then rebuild lib/* from scratch.');
    expect(p('Remove *.log. Keep src/* as it is.')).toBe('Remove *.log. Keep src/* as it is.');
    expect(p('*The run is over.* Next.')).toBe('The run is over. Next.');
  });
  it('underscores are never emphasis', () => {
    expect(p('__init__ snake_case _x_ __y__')).toBe('__init__ snake_case _x_ __y__');
  });
  it('headings, a leading quote and list markers stay as written', () => {
    expect(p('# of retries is 3')).toBe('# of retries is 3');
    expect(p('> quoted')).toBe('> quoted');
    expect(p('- a\n* b\n+ c\n1. d\n2) e')).toBe('- a * b + c 1. d 2) e');
  });
  it('old plain prose comes back unchanged', () => {
    for (const s of ['docs/superpowers/plans/x.md', 'a glob like src/**/*.ts', 'snake_case_name', 'see #123', 'pick <slug> or <name>', 'a > b', '3 items left', '2 * 3 = 6', '[ ] not a link', 'fn(a)(b)']) expect(p(s)).toBe(s);
  });
  it('an unmatched mark stays as written', () => {
    expect(p('**x and `y and [z](')).toBe('**x and `y and [z](');
  });
});

describe('itemPlainLines: the same projection, line by line (fix round 1, F6)', () => {
  it('each line is projected, the lines joined by a newline; blank lines and fence lines go', () => {
    expect(itemPlainLines('Run `a` *now*\n\nthen **b**\n```sh\nccrc doctor\n```\n[the spec](https://example.com/s)')).toBe('Run a now\nthen b\nccrc doctor\nthe spec');
  });
  it('a line with no marks is kept as written, its whitespace collapsed', () => {
    expect(itemPlainLines('  end the run  \nsrc/*.ts stays')).toBe('end the run\nsrc/*.ts stays');
  });
});

describe('itemPlainText: bounded time', () => {
  it('a 20000-character run of stars, brackets, backticks, tildes or "[a](" returns fast', () => {
    for (const s of ['*'.repeat(20000), '['.repeat(20000), '`'.repeat(20000), '~'.repeat(20000), '[a]('.repeat(5000), ' *x'.repeat(7000), '`a``b```c'.repeat(2200), '<'.repeat(20000), '[['.repeat(10000) + 'a' + '](x)'.repeat(10000)]) {
      const t = performance.now();
      itemPlainText(s);
      // Linear time is well under this on a loaded box; a quadratic scan of 20000 characters takes seconds.
      expect(performance.now() - t).toBeLessThan(250);
    }
  });
});
