'use client';

import { useDeferredValue, useState, useTransition } from 'react';

import {
  formatBytes,
  importanceLevels,
  inferKindAndImportance,
  manualKinds,
  noteTypes,
  presetDefinitions,
  resolveCanonicalHint,
  statusValues,
  type PresetKey,
} from '../lib/kb';
import type { ProxyResponse, ProjectOption } from '../lib/types';

type NotesAppProps = {
  projects: ProjectOption[];
  maxUploadBytes: number;
  projectManifestPath: string;
};

type FormState = {
  rawText: string;
  projectSlug: string;
  kind: string;
  noteType: string;
  importance: string;
  status: string;
  followUpBy: string;
  reminderDate: string;
  reminderTime: string;
  decisionFlag: boolean;
  relatedProjects: string;
  tags: string;
};

const responseFields = [
  ['project', 'Projeto'],
  ['kind', 'Kind'],
  ['notePath', 'Nota'],
  ['canonicalPath', 'Canonica'],
  ['followupPath', 'Follow-up'],
  ['reminderPath', 'Lembrete'],
  ['projectPath', 'Pagina do projeto'],
  ['attachmentPath', 'Anexo'],
] as const;

const initialState = (projectSlug: string): FormState => ({
  rawText: '',
  projectSlug,
  kind: 'manual_note',
  noteType: '',
  importance: '',
  status: '',
  followUpBy: '',
  reminderDate: '',
  reminderTime: '',
  decisionFlag: false,
  relatedProjects: '',
  tags: '',
});

export function NotesApp({ projects, maxUploadBytes, projectManifestPath }: NotesAppProps) {
  const [preset, setPreset] = useState<PresetKey>('manual');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [form, setForm] = useState<FormState>(initialState(projects[0]?.slug ?? 'inbox'));
  const [feedback, setFeedback] = useState<{ tone: 'idle' | 'error' | 'success'; message: string }>({
    tone: 'idle',
    message: '',
  });
  const [result, setResult] = useState<ProxyResponse | null>(null);
  const [isPending, startTransition] = useTransition();

  const deferredText = useDeferredValue(form.rawText);
  const suggestion = inferKindAndImportance(deferredText);

  const canonicalHint = resolveCanonicalHint(form.kind, form.noteType, form.decisionFlag);
  const manifestLoaded = projects.length > 1;

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function applyPreset(nextPreset: PresetKey) {
    const config = presetDefinitions[nextPreset];
    setPreset(nextPreset);
    setForm((current) => ({
      ...current,
      kind: config.kind,
      noteType: config.noteType,
      importance: config.importance,
      status: config.status,
      decisionFlag: config.decisionFlag,
      ...(nextPreset !== 'reminder'
        ? {
            reminderDate: current.reminderDate,
            reminderTime: current.reminderTime,
          }
        : {}),
    }));
    if (nextPreset !== 'manual') {
      setDetailsOpen(true);
    }
  }

  function applySuggestion() {
    setForm((current) => ({
      ...current,
      kind: suggestion.kind,
      importance: suggestion.importance,
    }));
  }

  function resetForNextNote() {
    setForm((current) => ({
      ...current,
      rawText: '',
      followUpBy: '',
      reminderDate: '',
      reminderTime: '',
      relatedProjects: '',
      tags: '',
    }));
    setAttachment(null);
    setFileInputKey((current) => current + 1);
  }

  function handleAttachmentChange(file: File | null) {
    if (!file) {
      setAttachment(null);
      return;
    }
    if (file.size > maxUploadBytes) {
      setAttachment(null);
      setFeedback({
        tone: 'error',
        message: `O arquivo excede o limite de ${formatBytes(maxUploadBytes)}.`,
      });
      setFileInputKey((current) => current + 1);
      return;
    }
    setAttachment(file);
    setFeedback({ tone: 'idle', message: '' });
  }

  async function submitForm() {
    const payload = new FormData();
    payload.set('raw_text', form.rawText);
    payload.set('project_slug', form.projectSlug);
    payload.set('kind', form.kind);
    payload.set('note_type', form.noteType);
    payload.set('importance', form.importance);
    payload.set('status', form.status);
    payload.set('follow_up_by', form.followUpBy);
    payload.set('reminder_date', form.reminderDate);
    payload.set('reminder_time', form.reminderTime);
    payload.set('decision_flag', String(form.decisionFlag));
    payload.set('related_projects', form.relatedProjects);
    payload.set('tags', form.tags);

    if (attachment) {
      payload.set('attachment', attachment);
    }

    try {
      const response = await fetch('/api/kb-proxy', {
        method: 'POST',
        body: payload,
      });

      const data = (await response.json().catch(() => null)) as ProxyResponse | null;
      if (!response.ok || data?.ok === false) {
        setResult(data);
        setFeedback({
          tone: 'error',
          message: String(data?.message || 'Falha ao enviar a nota para o webhook do kb.'),
        });
        return;
      }

      setResult(data);
      setFeedback({
        tone: 'success',
        message: 'Nota enviada com sucesso para o fluxo atual do kb.',
      });
      resetForNextNote();
    } catch (error) {
      setResult(null);
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Falha inesperada ao enviar a nota.',
      });
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback({ tone: 'idle', message: '' });
    setResult(null);

    if (!form.rawText.trim()) {
      setFeedback({ tone: 'error', message: 'Digite o texto livre antes de enviar.' });
      return;
    }

    if (form.reminderTime && !form.reminderDate) {
      setFeedback({ tone: 'error', message: 'Horario de lembrete exige data.' });
      return;
    }

    startTransition(() => {
      void submitForm();
    });
  }

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="relative rounded-[24px] bg-white/80 p-4 shadow-panel sm:p-5">
          {isPending ? <div className="loading-bar" aria-hidden="true" /> : null}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="min-w-0 flex-1">
              <span className="mb-2 block text-sm font-medium text-stone-700">Projeto</span>
              <div className="field-shell rounded-2xl px-4 py-3">
                <select
                  value={form.projectSlug}
                  onChange={(event) => updateField('projectSlug', event.target.value)}
                  className="field-input"
                >
                  {projects.map((project) => (
                    <option key={project.slug} value={project.slug}>
                      {project.label} ({project.slug})
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <button
              type="button"
              onClick={() => setDetailsOpen((current) => !current)}
              className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-500 hover:text-ink"
            >
              {detailsOpen ? 'Menos opcoes' : 'Mais opcoes'}
            </button>
          </div>

          <div className="space-y-4">
            <div className="field-shell rounded-[24px] px-4 py-4">
              <label className="mb-2 block text-sm font-semibold text-stone-700" htmlFor="rawText">
                Texto
              </label>
              <textarea
                id="rawText"
                value={form.rawText}
                onChange={(event) => updateField('rawText', event.target.value)}
                rows={7}
                placeholder="Escreva a nota aqui"
                className="field-input resize-y text-base leading-7"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {(Object.entries(presetDefinitions) as [PresetKey, (typeof presetDefinitions)[PresetKey]][]).map(
                ([key, config]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className={`rounded-2xl border px-3 py-3 text-sm font-medium text-left transition ${
                      preset === key
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : 'border-stone-200 bg-white text-stone-700 hover:border-stone-400'
                    }`}
                  >
                    {config.label}
                  </button>
                ),
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
              <span>
                Sugestao: <strong>{suggestion.kind}</strong> / <strong>{suggestion.importance}</strong>
              </span>
              <button
                type="button"
                onClick={applySuggestion}
                className="rounded-full border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-stone-800 transition hover:border-stone-500"
              >
                Aplicar
              </button>
            </div>
          </div>
        </section>

        {detailsOpen ? (
          <section className="rounded-[24px] bg-white/80 p-4 shadow-panel sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-ink">Opcoes avancadas</h2>
              <span className="text-xs text-stone-500">{manifestLoaded ? 'manifesto carregado' : 'fallback local'}</span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">Kind</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <select
                    value={form.kind}
                    onChange={(event) => updateField('kind', event.target.value)}
                    className="field-input"
                  >
                    {manualKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">note_type</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <select
                    value={form.noteType}
                    onChange={(event) => updateField('noteType', event.target.value)}
                    className="field-input"
                  >
                    <option value="">auto</option>
                    {noteTypes.map((noteType) => (
                      <option key={noteType} value={noteType}>
                        {noteType}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">importance</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <select
                    value={form.importance}
                    onChange={(event) => updateField('importance', event.target.value)}
                    className="field-input"
                  >
                    <option value="">auto</option>
                    {importanceLevels.map((importance) => (
                      <option key={importance} value={importance}>
                        {importance}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">status</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <select
                    value={form.status}
                    onChange={(event) => updateField('status', event.target.value)}
                    className="field-input"
                  >
                    <option value="">auto</option>
                    {statusValues.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">follow_up_by</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <input
                    type="date"
                    value={form.followUpBy}
                    onChange={(event) => updateField('followUpBy', event.target.value)}
                    className="field-input"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">reminder_date</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <input
                    type="date"
                    value={form.reminderDate}
                    onChange={(event) => updateField('reminderDate', event.target.value)}
                    className="field-input"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">reminder_time</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <input
                    type="time"
                    value={form.reminderTime}
                    onChange={(event) => updateField('reminderTime', event.target.value)}
                    className="field-input"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">related_projects</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <input
                    type="text"
                    value={form.relatedProjects}
                    onChange={(event) => updateField('relatedProjects', event.target.value)}
                    className="field-input"
                    placeholder="fe-connect, wander-rag"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">tags</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <input
                    type="text"
                    value={form.tags}
                    onChange={(event) => updateField('tags', event.target.value)}
                    className="field-input"
                    placeholder="parser, webhook, deploy"
                  />
                </div>
              </label>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[1fr,auto] md:items-end">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-stone-700">Anexo</span>
                <div className="field-shell rounded-2xl px-4 py-3">
                  <input
                    key={fileInputKey}
                    type="file"
                    onChange={(event) => handleAttachmentChange(event.target.files?.[0] ?? null)}
                    className="field-input"
                  />
                </div>
                <p className="mt-2 text-xs text-stone-500">Limite configurado: {formatBytes(maxUploadBytes)}.</p>
              </label>

              <label className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={form.decisionFlag}
                  onChange={(event) => updateField('decisionFlag', event.target.checked)}
                  className="size-4 rounded border-stone-400"
                />
                <span>decision_flag</span>
              </label>
            </div>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex min-w-[160px] items-center justify-center gap-2 rounded-full bg-stone-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <>
                <span className="loading-dot" aria-hidden="true" />
                Enviando
              </>
            ) : (
              'Enviar'
            )}
          </button>

          {isPending ? <span className="text-sm text-stone-500">Aguarde o envio terminar.</span> : null}
        </div>

        {feedback.tone !== 'idle' ? (
          <section
            className={`rounded-[24px] p-4 shadow-panel ${
              feedback.tone === 'success'
                ? 'bg-emerald-50 text-emerald-900'
                : 'bg-rose-50 text-rose-800'
            }`}
          >
            <p className="text-sm font-semibold">{feedback.message}</p>
          </section>
        ) : null}

        {result ? (
          <section className="rounded-[24px] bg-white/80 p-4 shadow-panel">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink">Resposta</p>
              <span className="text-xs text-stone-500">{canonicalHint}</span>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-6 text-stone-700">
              {responseFields.map(([field, label]) => {
                const value = result[field];
                if (!value) {
                  return null;
                }
                return (
                  <div key={field} className="flex items-start justify-between gap-4 border-b border-stone-100 pb-2">
                    <span className="text-stone-500">{label}</span>
                    <strong className="text-right text-stone-900">{String(value)}</strong>
                  </div>
                );
              })}

              {result.message ? (
                <div className="rounded-2xl bg-stone-50 px-4 py-3 text-sm text-stone-700">{String(result.message)}</div>
              ) : null}

              <div className="rounded-2xl bg-stone-50 px-4 py-3 text-xs text-stone-500">
                {projectManifestPath || 'KB_PROJECTS_FILE nao configurado'}
              </div>
            </div>
          </section>
        ) : null}
      </form>
    </div>
  );
}
