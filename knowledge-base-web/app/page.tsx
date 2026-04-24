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
    <main className="px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <section className="paper-panel overflow-hidden rounded-[28px]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-200/70 px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-stone-500">KB Web</p>
              <h1 className="mt-1 text-2xl font-semibold text-ink sm:text-3xl">Nova nota</h1>
            </div>

            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-900"
              >
                Sair
              </button>
            </form>
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
