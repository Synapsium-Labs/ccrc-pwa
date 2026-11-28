// The act journal's signed head line (Overlord W2, act journal plan Task A3): `actHeadOneLine` (L1) over every arm, and the line
// component over fixtures. The line names a head by its record number and its signed state, and never a record's content.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ActHeadLine } from '../src/overlord/ActHeadLine';
import { actHeadOneLine, type ActHeadView } from '../src/overlord/actHeadWords';

afterEach(() => { cleanup(); });

const read = (over: Partial<Extract<ActHeadView, { kind: 'read' }>> = {}): ActHeadView => ({
  kind: 'read', sequence: 1234, unsigned: null, verify: 'verified', extendsKept: 'extends', keptSequence: 1200, ...over,
});

describe('actHeadOneLine', () => {
  it('no head yet draws nothing', () => { expect(actHeadOneLine({ kind: 'none' })).toBeNull(); });
  it('a failed read says unmeasured, never a value', () => {
    expect(actHeadOneLine({ kind: 'unmeasured' })).toEqual({ text: 'Overlord act journal: its signed head could not be read', tone: 'attention', word: 'unmeasured' });
  });
  it('a verified head that extends the kept one, or nothing kept yet, reads signed, with the record number grouped', () => {
    expect(actHeadOneLine(read())).toEqual({ text: 'Overlord act journal: record 1,234, signed', tone: 'ok', word: 'signed' });
    expect(actHeadOneLine(read({ extendsKept: 'first', keptSequence: null }))?.word).toBe('signed');
  });
  it('an unsigned head says so, with the server\'s word', () => {
    expect(actHeadOneLine(read({ unsigned: 'shared-user', verify: 'not-signed' }))).toEqual({
      text: 'Overlord act journal: record 1,234, unsigned (shared-user)', tone: 'quiet', word: 'unsigned' });
  });
  it('a signature that does not verify is a warning', () => {
    expect(actHeadOneLine(read({ verify: 'failed' }))).toMatchObject({ tone: 'attention', word: 'signature-failed' });
  });
  it('a browser with no Ed25519 says it cannot check, and does not read as verified', () => {
    expect(actHeadOneLine(read({ verify: 'cannot-verify-here' }))).toEqual({
      text: 'Overlord act journal: record 1,234, signed (this browser cannot check the signature)', tone: 'quiet', word: 'cannot-verify-here' });
  });
  it('a head that does not extend the kept one is a warning naming the kept record, whatever the signature says', () => {
    for (const v of [read({ extendsKept: 'does-not-extend' }), read({ extendsKept: 'does-not-extend', unsigned: 'shared-user', verify: 'not-signed' })]) {
      expect(actHeadOneLine(v)).toEqual({
        text: 'Overlord act journal: record 1,234 does not extend record 1,200, which this device kept: the journal went back or was rewritten',
        tone: 'attention', word: 'does-not-extend' });
    }
    expect(actHeadOneLine(read({ extendsKept: 'does-not-extend', keptSequence: null }))?.text).toContain('the record this device kept');
  });
  it('an extends check that could not be read is a warning, before the signature\'s word', () => {
    expect(actHeadOneLine(read({ extendsKept: 'unmeasured', unsigned: 'shared-user', verify: 'not-signed' }))).toMatchObject({ tone: 'attention', word: 'extends-unmeasured' });
  });
});

describe('ActHeadLine', () => {
  it('draws the line with its tone and word as class and data hooks', () => {
    const { container } = render(<ActHeadLine view={read({ unsigned: 'isolation-unmeasured', verify: 'not-signed' })} />);
    const p = container.querySelector<HTMLElement>('[data-act-head-line]');
    expect(p?.textContent).toBe('Overlord act journal: record 1,234, unsigned (isolation-unmeasured)');
    expect(p?.getAttribute('role')).toBe('status');
    expect(p?.dataset.tone).toBe('quiet');
    expect(p?.dataset.actHead).toBe('unsigned');
    expect(p?.className).toBe('ovl-line ovl-status--quiet');
  });
  it('draws nothing with no head', () => {
    const { container } = render(<ActHeadLine view={{ kind: 'none' }} />);
    expect(container.querySelector('[data-act-head-line]')).toBeNull();
  });
});
