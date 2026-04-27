import type { Dashboard, DashboardPayload } from './models/dashboard';
import type { IntegrationsResponse } from './models/integration';
import type { NoteDetail } from './models/note';
import type { QueryResponse } from './models/query';
import { normalizeDashboard } from './normalizers/dashboard';

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`request_failed:${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchDashboard(): Promise<Dashboard> {
  return request<DashboardPayload>('/api/dashboard').then(normalizeDashboard);
}

export function fetchIntegrations(): Promise<IntegrationsResponse> {
  return request<IntegrationsResponse>('/api/integrations');
}

export async function fetchNote(id: string): Promise<NoteDetail> {
  const result = await request<{ ok: true; note: NoteDetail }>(`/api/notes/${encodeURIComponent(id)}`);
  return result.note;
}

export function runQuery(params: { query: string; projectSlug?: string; workspaceSlug?: string; mode?: 'search' | 'answer'; limit?: number }) {
  const search = new URLSearchParams({
    query: params.query,
    mode: params.mode || 'answer',
    projectSlug: params.projectSlug || '',
    workspaceSlug: params.workspaceSlug || '',
    limit: String(params.limit || 5),
  });
  return request<QueryResponse>(`/api/query?${search.toString()}`);
}
