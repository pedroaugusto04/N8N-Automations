import { logoutAction } from './actions';
import { NotesApp } from '../components/notes-app';
import { requireAuth } from '../lib/auth';
import { readProjectOptions } from '../lib/projects';

export const dynamic = 'force-dynamic';

function readMaxUploadBytes(): number {
  const parsed = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 1024 * 1024;
}

export default async function NotesPage() {
  await requireAuth();

  const projects = await readProjectOptions();
  const maxUploadBytes = readMaxUploadBytes();
  const manifestPath = String(process.env.KB_PROJECTS_FILE || '').trim();

  return (
    <main className="px-4 py-5 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="paper-panel overflow-hidden rounded-[30px]">
          <div className="grid gap-6 border-b border-stone-200/70 px-5 py-6 sm:px-8 lg:grid-cols-[1.5fr,0.8fr] lg:items-end">
            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.36em] text-pine">Cliente web do kb</p>
              <h1 className="font-serif text-4xl leading-tight text-ink sm:text-5xl">
                Texto livre primeiro, parametros quando ajudarem.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-600 sm:text-base">
                Esta interface envia notas manuais para o mesmo fluxo remote-first do <code>kb</code>. O
                formulario foi pensado para celular e desktop, mantendo a rapidez do comando e adicionando
                selecoes rapidas quando elas economizam tempo.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[24px] bg-white/75 px-5 py-4">
                <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Origem</p>
                <p className="mt-2 text-sm leading-6 text-stone-700">
                  Webhook atual do n8n, com segredo no servidor e compatibilidade com o processor existente.
                </p>
              </div>

              <form action={logoutAction}>
                <button
                  type="submit"
                  className="w-full rounded-[24px] border border-stone-300 bg-stone-950 px-5 py-4 text-sm font-semibold text-white transition hover:bg-stone-800"
                >
                  Encerrar sessao
                </button>
              </form>
            </div>
          </div>

          <NotesApp
            projects={projects}
            maxUploadBytes={maxUploadBytes}
            projectManifestPath={manifestPath}
          />
        </section>
      </div>
    </main>
  );
}
