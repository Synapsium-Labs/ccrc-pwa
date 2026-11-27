// The reader's history shapes are the shared Markdown library's (completion plan Task 12): `history.ts` imports nothing
// from it, so these type tests hold the mirrored shapes equal to the library's in both directions.
import type { CommitEntry } from '@synapsium-labs/pinax-lib/enhance';
import type { RenderInput } from '@synapsium-labs/pinax-lib/frame';
import type { HostAdapters } from '@synapsium-labs/pinax-lib/host';
import { expectTypeOf, test } from 'vitest';
import type { ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderCommit, ReaderVersionSeed } from '../src/docs/reader/history';

test('the mount input\'s changes callback is the one HostAdapters takes, both ways', () => {
  expectTypeOf<NonNullable<ReaderMountInput['changes']>>().toEqualTypeOf<NonNullable<HostAdapters['changes']>>();
});

test('the mount input\'s openVersion callback is the one HostAdapters takes, both ways', () => {
  expectTypeOf<NonNullable<ReaderMountInput['openVersion']>>().toEqualTypeOf<NonNullable<HostAdapters['openVersion']>>();
});

test('changes and openVersion are keys of HostAdapters', () => {
  expectTypeOf<'changes'>().toMatchTypeOf<keyof HostAdapters>();
  expectTypeOf<'openVersion'>().toMatchTypeOf<keyof HostAdapters>();
});

test('ReaderCommit is the library\'s CommitEntry', () => {
  expectTypeOf<ReaderCommit>().toEqualTypeOf<CommitEntry>();
});

test('a ReaderVersionSeed is a version the library\'s render input takes', () => {
  expectTypeOf<ReaderVersionSeed>().toMatchTypeOf<NonNullable<RenderInput['version']>>();
});
