// The Flows screen (flows design 2026-11-19 §9): the list, a copy from a template, and the editor's save and publish.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { skeletonFlowDoc, type FlowAnswer, type FlowDoc, type FlowsListAnswer } from '../../shared/flows';
import { FlowsScreen } from '../src/flows/FlowsScreen';

type Call = { url: string; method: string; body: unknown };

function stubServer(answers: (c: Call) => { status?: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const c: Call = { url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const a = answers(c);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { 'content-type': 'application/json' } });
  }));
  return calls;
}

const answerFor = (doc: FlowDoc, versions: number[] = []): FlowAnswer => ({
  flow: { id: 4, title: doc.title, source: { template: 'ccrc', version: 1 }, updatedAt: 1, latestVersion: versions.at(-1) ?? null },
  draft: { ok: true, doc }, problems: [], versions: versions.map((v) => ({ version: v, publishedAt: 1 })),
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the Flows list', () => {
  it('shows the templates and copies one', async () => {
    const list: FlowsListAnswer = { flows: [], templates: [{ id: 'ccrc', version: 1, title: 'ccrc', note: 'ccrc\'s own method.', doc: skeletonFlowDoc('ccrc') }] };
    const calls = stubServer((c) => (c.method === 'POST' ? { body: { ok: true, id: 4 } } : { body: list }));
    render(<FlowsScreen />);
    expect(await screen.findByText('ccrc\'s own method.')).toBeInTheDocument();
    expect(screen.getByText(/No flow yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/flows')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ template: 'ccrc' });
    await waitFor(() => expect(location.pathname).toBe('/flows/4'));
  });
});

describe('the Flows editor', () => {
  it('locks a protocol step, edits an added step, saves the draft, and publishes the next version', async () => {
    let doc = skeletonFlowDoc('Mine');
    const calls = stubServer((c) => {
      if (c.method === 'PUT') { doc = (c.body as { doc: FlowDoc }).doc; return { body: { ok: true, problems: [] } }; }
      if (c.method === 'POST') return { body: { ok: true, version: 1 } };
      return { body: answerFor(doc, calls.some((x) => x.method === 'POST') ? [1] : []) };
    });
    render(<FlowsScreen openId={4} />);
    // The diagram's block and the outline's row are both a way to it; the diagram's comes first.
    fireEvent.click((await screen.findAllByRole('button', { name: /Dispatch the wave/ }))[0]!);
    expect(screen.getByText(/It can be moved, never edited or removed/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Prompt/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add a step after' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Prompt/ }), { target: { value: 'Build it, a failing test first.' } });
    expect(screen.getByText('unsaved changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const saved = (calls.find((c) => c.method === 'PUT')!.body as { doc: FlowDoc }).doc;
    expect(saved.blocks.find((b) => b.title === 'New step')?.prompt).toBe('Build it, a failing test first.');

    fireEvent.click(screen.getByRole('button', { name: 'Publish v1' }));
    expect(await screen.findByText('Published as version 1.')).toBeInTheDocument();
  });

  it('will not publish a flow with problems, and lists them', async () => {
    const doc = skeletonFlowDoc('Broken');
    doc.edges = doc.edges.filter((e) => e.from !== 'verify');
    stubServer(() => ({ body: answerFor(doc) }));
    render(<FlowsScreen openId={4} />);
    expect(await screen.findByRole('heading', { name: 'Problems' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish v1' })).toBeDisabled();
  });

  it('says so when the draft cannot be read, and never shows an empty flow', async () => {
    stubServer(() => ({ body: { ...answerFor(skeletonFlowDoc('x')), draft: { ok: false, reason: 'unknown schema 9' } } }));
    render(<FlowsScreen openId={4} />);
    expect(await screen.findByRole('heading', { name: 'This draft can\'t be read' })).toBeInTheDocument();
    expect(screen.getByText(/unknown schema 9/)).toBeInTheDocument();
  });
});
