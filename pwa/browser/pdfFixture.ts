// Synthetic PDFs for the PDF frame's browser rows and labs (X2 P3, spec 2026-11-18 section 4.4; plan Tasks P3.2 and
// P3.3). Built here byte by byte, never taken from anywhere: one page of standard-font text (Helvetica, not embedded, so
// the frame's inline standard fonts draw it), three link annotations (a URI, a Launch action and a JavaScript action),
// a document-level JavaScript open action that would show an alert and submit a form, and, on request, a 16 x 16 JPEG 2000
// image or an exact total size. Every word in them is a placeholder; every address is under `example.invalid`.
import { Buffer } from 'node:buffer';

/** A 16 x 16 JPEG 2000 codestream (a blue square with a white diagonal), made for this file with Pillow's encoder. */
export const JPX_16 = Buffer.from(
  '/0//UQAvAAAAAAAQAAAAEAAAAAAAAAAAAAAAEAAAABAAAAAAAAAAAAADBwEBBwEBBwEB/1IADAAAAAEABAQEAAH/XAAQQEBISFBISFBISFBISFD/ZAAlAAFDcmVhdGVk'
  + 'IGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAH5AAH/k8+0CAc7wPhBAc+0CAQfwfOBg+cDH4AQBQUEK8D5AMD5AUPtAwkJfwH/f8B8IMB8IMH1AQAIBQQf'
  + 'w+oEh9QLH4A4DK57fwsUJp3fA85VuvP/f8HzhIPnCR+AKAyy7g8LFbJKBNWznR/A+QHA+QJB9QIADK5BCxOg3wPNPGHH2h0faHz8xEAkx7xPZxA9ACOiPymdEyTDXNBA'
  + 'kxLWJk48wFZwBRTS8c0ZPRWT0cq3txR3kzOyw+oMh9QbH4B4JKkjYoLXJ2F/JhZsJNYhR8OMHxxMCLVDvxTS7yRDBYNIDmJB/WL8f8Hzi4PnGQ+0OCTHvE9lyWAlI95/'
  + 'JMNcs4pK3TPW3v9/FNLxzRk9FZPR0dDV/3/H2ikfaLT8yABiT74NNv6TYdDgmQupJnA8GtLlF2JPvcbjs28xTtuHbCtPCE/+65Y5qccU0n+ekfaH9WHGA6LKLitE5ZOa'
  + 'Pd4vspbE6hmQQ5BRz8PqEIfUJz8xoBTYypTiVjh+j5tSY1mbf68U2MdU2Tm5pycJ4ipD5W7/cV2HYY/fiqm5vkznei6hxA0vq8saSMcsqpaugifB846D5yEPtGRiT74N'
  + 'Nv6TYdDgmQuAf2JPvcbjs28xTtuHbCtO/08U0n+ekfaH9WHGA6LKRVYjfwefZwcuIMXn/9k=',
  'base64',
);

/** The targets the three link annotations name, as the frame shows them. */
export const PDF_LINKS = {
  uri: 'https://example.invalid/link',
  launch: 'example-launch.exe',
  js: 'https://example.invalid/js',
} as const;

export interface PdfFixtureOptions {
  /** The total size in bytes, made exact with an unreferenced padding stream; absent, as small as it comes. */
  readonly size?: number;
  /** Draw `JPX_16` on the page through `/JPXDecode`. */
  readonly jpx?: boolean;
  /** The page's first line. */
  readonly title?: string;
}

/** A PDF of exactly `o.size` bytes when given: the padding stream's length is adjusted until the file is that size. */
export function buildFixturePdf(o: PdfFixtureOptions = {}): Uint8Array {
  if (o.size === undefined) return build(o, -1);
  let pad = 0;
  for (let i = 0; i < 8; i += 1) {
    const got = build(o, pad).length;
    if (got === o.size) return build(o, pad);
    pad += o.size - got;
    if (pad < 0) throw new RangeError(`buildFixturePdf: ${o.size} bytes is below the fixture's own size`);
  }
  throw new RangeError(`buildFixturePdf: ${o.size} bytes was not reached`);
}

type Obj = string | { readonly dict: string; readonly stream: Buffer };

function build(o: PdfFixtureOptions, padLen: number): Uint8Array {
  const objs: Obj[] = [];
  const add = (x: Obj): number => { objs.push(x); return objs.length; };
  const catalog = add('');
  const pages = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const js = add('<< /S /JavaScript /JS (app.alert\\("placeholder"\\); this.submitForm\\("https://example.invalid/form"\\);) >>');
  const link = (y: number, action: string): number =>
    add(`<< /Type /Annot /Subtype /Link /Rect [72 ${y} 320 ${y + 20}] /Border [0 0 0] /A ${action} >>`);
  const uri = link(680, `<< /S /URI /URI (${PDF_LINKS.uri}) >>`);
  const launch = link(640, `<< /S /Launch /F (${PDF_LINKS.launch}) >>`);
  const jsLink = link(600, `<< /S /JavaScript /JS (app.launchURL\\("${PDF_LINKS.js}"\\);) >>`);
  let xobj = '';
  if (o.jpx === true) {
    const im = add({ dict: `<< /Type /XObject /Subtype /Image /Width 16 /Height 16 /Filter /JPXDecode /Length ${JPX_16.length} >>`, stream: JPX_16 });
    xobj = ` /XObject << /Im1 ${im} 0 R >>`;
  }
  const text = `BT /F1 18 Tf 72 720 Td (${o.title ?? 'A synthetic PDF'}) Tj ET\n`
    + 'BT /F1 12 Tf 76 686 Td (A link to an address) Tj ET\n'
    + 'BT /F1 12 Tf 76 646 Td (A launch action) Tj ET\n'
    + 'BT /F1 12 Tf 76 606 Td (A JavaScript action) Tj ET\n'
    + (o.jpx === true ? 'q 64 0 0 64 72 500 cm /Im1 Do Q\n' : '');
  const contents = add({ dict: `<< /Length ${Buffer.byteLength(text, 'latin1')} >>`, stream: Buffer.from(text, 'latin1') });
  const page = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >>${xobj} >> `
    + `/Contents ${contents} 0 R /Annots [${uri} 0 R ${launch} 0 R ${jsLink} 0 R] /AA << /O ${js} 0 R >> >>`);
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R /OpenAction ${js} 0 R /Names << /JavaScript << /Names [(p) ${js} 0 R] >> >> >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;
  if (padLen >= 0) add({ dict: `<< /Length ${padLen} >>`, stream: Buffer.alloc(padLen, 0x20) });
  return writePdf(objs, catalog);
}

/** L1's parser/drawing workload: 52 distinct pages of synthetic prose with a real embedded TrueType face, not padding. */
export function buildTextFixturePdf(embeddedFont: Uint8Array): Uint8Array {
  const objs: Obj[] = ['', ''];
  const add = (obj: Obj): number => objs.push(obj);
  const fontFile = add({
    dict: `<< /Length ${embeddedFont.length} /Length1 ${embeddedFont.length} >>`, stream: Buffer.from(embeddedFont),
  });
  const descriptor = add('<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [-544 -303 1302 980] '
    + `/ItalicAngle 0 /Ascent 905 /Descent -212 /CapHeight 688 /StemV 80 /FontFile2 ${fontFile} 0 R >>`);
  const widths = Array<string>(95).fill('500').join(' ');
  const font = add('<< /Type /Font /Subtype /TrueType /BaseFont /LiberationSans /Encoding /WinAnsiEncoding '
    + `/FirstChar 32 /LastChar 126 /Widths [${widths}] /FontDescriptor ${descriptor} 0 R >>`);
  const paragraphs = [
    'The morning light falls across the table where a stack of maps awaits its labels.',
    'A small wooden boat follows the curve of the river until the towers are out of view.',
    'At the market, a baker lays out the loaves in rows and turns the sign toward the street.',
    'The trail climbs through stands of fir, then bends back toward the open meadow.',
  ];
  const kids: string[] = [];
  for (let page = 1; page <= 52; page += 1) {
    const lines = ['BT /F1 11 Tf 72 720 Td 14 TL'];
    for (let line = 1; line <= 40; line += 1) {
      lines.push(`(Page ${page}, line ${line}. ${paragraphs[(page + line) % paragraphs.length]}) Tj T*`);
    }
    const stream = Buffer.from(`${lines.join('\n')} ET`, 'ascii');
    const content = add({ dict: `<< /Length ${stream.length} >>`, stream });
    const link = page === 52 ? add(`<< /Type /Annot /Subtype /Link /Rect [72 660 180 674] /A << /S /URI /URI (${PDF_LINKS.uri}) >> >>`) : null;
    const annots = link === null ? '' : ` /Annots [${link} 0 R]`;
    const leaf = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R${annots} >>`);
    kids.push(`${leaf} 0 R`);
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  return writePdf(objs, 1);
}

function writePdf(objs: readonly Obj[], catalog: number): Uint8Array {
  const head = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
  const parts: Buffer[] = [head];
  let off = head.length;
  const offsets: number[] = [];
  objs.forEach((x, i) => {
    offsets.push(off);
    const b = typeof x === 'string'
      ? Buffer.from(`${i + 1} 0 obj\n${x}\nendobj\n`, 'latin1')
      : Buffer.concat([Buffer.from(`${i + 1} 0 obj\n${x.dict}\nstream\n`, 'latin1'), x.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    parts.push(b);
    off += b.length;
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) xref += `${String(at).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
  return new Uint8Array(Buffer.concat([...parts, Buffer.from(xref + trailer, 'latin1')]));
}
