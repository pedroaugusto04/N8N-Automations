import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithAppProviders } from '../app/test-utils';
import { AppShell } from './AppShell';

const dashboard = {
  workspaces: [{ workspaceSlug: 'default', displayName: 'Default', githubRepos: ['acme/repo'], projectSlugs: ['n8n-automations'] }],
  projects: [
    {
      projectSlug: 'n8n-automations',
      displayName: 'N8N Automations',
      repoFullName: 'acme/repo',
      workspaceSlug: 'default',
      aliases: ['n8n'],
      defaultTags: ['backend', 'automation'],
      enabled: true,
    },
  ],
  notes: [
    {
      id: 'note-1',
      path: '20 Inbox/note.md',
      type: 'event',
      title: 'Deploy rollout',
      project: 'n8n-automations',
      workspace: 'default',
      tags: ['deploy'],
      date: '2026-04-27',
      status: 'open',
      summary: 'Revisar deploy.',
      source: 'test',
    },
  ],
  reviews: [
    {
      id: 'review-1',
      title: 'Review do push',
      repo: 'acme/repo',
      project: 'n8n-automations',
      branch: 'main',
      date: '2026-04-27',
      status: 'open',
      summary: 'Sem regressao critica.',
      impact: 'Baixo',
      changedFiles: ['src/app.ts'],
      generatedNotePath: 'reviews/review.md',
      findings: [{ severity: 'low', file: 'src/app.ts', line: 3, summary: 'Ajuste menor', recommendation: 'Revisar', status: 'open' }],
    },
  ],
  reminders: [],
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/dashboard') {
      return Response.json(dashboard);
    }
    if (url === '/api/notes/note-1') {
      return Response.json({
        ok: true,
        note: {
          ...dashboard.notes[0],
          markdown: '# Deploy rollout\n\n## Resumo\n\nRevisar deploy.',
          frontmatter: {},
          links: [],
          origin: 'vault',
        },
      });
    }
    if (url.startsWith('/api/query?')) {
      return Response.json({
        ok: true,
        mode: 'answer',
        query: 'deploy',
        matches: [{ path: '20 Inbox/note.md', title: 'Deploy rollout', projectSlug: 'n8n-automations', score: 10, snippet: 'deploy' }],
        answer: { answer: 'Encontrei 1 nota.', bullets: [], citedPaths: ['20 Inbox/note.md'] },
      });
    }
    return new Response(null, { status: 404 });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppShell', () => {
  it('renders dashboard data from the API and navigates with real routes', async () => {
    vi.stubGlobal('fetch', mockFetch());

    renderWithAppProviders(<AppShell />);

    expect(await screen.findByRole('heading', { name: 'Vault Home' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Vault' }));
    fireEvent.click(await screen.findByText('Deploy rollout'));

    expect((await screen.findAllByRole('heading', { name: 'Deploy rollout' })).length).toBeGreaterThan(0);
    expect(await screen.findByText('20 Inbox/note.md')).toBeInTheDocument();
  });

  it('opens a note directly from a route parameter', async () => {
    vi.stubGlobal('fetch', mockFetch());

    renderWithAppProviders(<AppShell />, { route: '/vault/note-1' });

    expect((await screen.findAllByRole('heading', { name: 'Deploy rollout' })).length).toBeGreaterThan(0);
    expect(await screen.findByText('20 Inbox/note.md')).toBeInTheDocument();
  });
});
