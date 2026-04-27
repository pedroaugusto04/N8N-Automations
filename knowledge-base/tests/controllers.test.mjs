import test from 'node:test';
import assert from 'node:assert/strict';

import { DashboardController, HealthController, OperationsController } from '../dist/interfaces/http/controllers/knowledge.controllers.js';

test('health controller exposes service status', () => {
  const controller = new HealthController();

  assert.deepEqual(controller.health(), { ok: true, service: 'knowledge-base' });
});

test('dashboard controller delegates project, workspace and note reads to use cases', async () => {
  const dashboard = {
    workspaces: [{ workspaceSlug: 'default' }],
    projects: [{ projectSlug: 'n8n-automations' }],
    notes: [{ id: 'note-1' }],
    reviews: [],
    reminders: [],
  };
  const controller = new DashboardController(
    { execute: async () => dashboard },
    { execute: async (id) => ({ id, title: 'Note detail' }) },
    { execute: async (query) => ({ ok: true, query }) },
  );

  assert.deepEqual(await controller.projects(), { ok: true, projects: dashboard.projects });
  assert.deepEqual(await controller.workspaces(), { ok: true, workspaces: dashboard.workspaces });
  assert.deepEqual(await controller.notes(), { ok: true, notes: dashboard.notes });
  assert.deepEqual(await controller.note('note-1'), { ok: true, note: { id: 'note-1', title: 'Note detail' } });
  assert.deepEqual(await controller.query({ query: 'deploy', limit: '7' }), { ok: true, query: { query: 'deploy', limit: 7 } });
});

test('operations controller normalizes reminder dispatch and mark-sent inputs', async () => {
  const calls = [];
  const controller = new OperationsController(
    { execute: async (body) => ({ op: 'ingest', body }) },
    { execute: async (body) => ({ op: 'onboarding', body }) },
    { execute: async (body) => ({ op: 'conversation', body }) },
    { execute: async (mode) => { calls.push(['dispatch', mode]); return { mode }; } },
    { execute: async (ids) => { calls.push(['mark', ids]); return { ids }; } },
  );

  assert.deepEqual(await controller.remindersDispatch('exact'), { mode: 'exact' });
  assert.deepEqual(await controller.remindersDispatch('invalid'), { mode: 'daily' });
  assert.deepEqual(await controller.remindersMarkSent({ ids: ['one'] }), { ids: ['one'] });
  assert.deepEqual(await controller.remindersMarkSent({ ids: 'one' }), { ids: [] });
  assert.deepEqual(calls, [
    ['dispatch', 'exact'],
    ['dispatch', 'daily'],
    ['mark', ['one']],
    ['mark', []],
  ]);
});
