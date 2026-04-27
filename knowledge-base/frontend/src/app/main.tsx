import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { runQuery, fetchDashboard, fetchNote } from '../shared/api/client';
import type { Dashboard, NoteSummary, Reminder, Review } from '../shared/api/types';
import { Badge, EmptyState, PageHead, Panel, Tags } from '../shared/ui/primitives';
import { projectName, typeIcon } from '../entities/format';
import '../shared/styles/global.css';

type View = 'home' | 'projects' | 'vault' | 'reviews' | 'search' | 'reminders';

const queryClient = new QueryClient();

function NoteRow({ note, dashboard, onOpen }: { note: NoteSummary; dashboard: Dashboard; onOpen: (id: string) => void }) {
  return (
    <article className="list-row clickable" onClick={() => onOpen(note.id)}>
      <div>
        <div className="meta-row">
          <Badge value={note.type} />
          <span className="meta">
            {projectName(dashboard.projects, note.project)} / {note.date}
          </span>
        </div>
        <h3>{note.title}</h3>
        <p>{note.summary}</p>
      </div>
      <span className="file-icon">{typeIcon(note.type)}</span>
    </article>
  );
}

function ReviewRow({ review, dashboard, onOpen }: { review: Review; dashboard: Dashboard; onOpen: (id: string) => void }) {
  const highCount = review.findings.filter((finding) => finding.severity === 'high').length;
  return (
    <article className="list-row clickable" onClick={() => onOpen(review.id)}>
      <div>
        <div className="meta-row">
          <Badge value={highCount ? `${highCount} high` : 'sem high'} tone={highCount ? 'high' : 'low'} />
          <span className="meta">
            {projectName(dashboard.projects, review.project)} / {review.date}
          </span>
        </div>
        <h3>{review.title}</h3>
        <p>{review.summary}</p>
      </div>
      <span className="file-icon">AI</span>
    </article>
  );
}

function ReminderRow({ reminder, dashboard, onOpenPath }: { reminder: Reminder; dashboard: Dashboard; onOpenPath: (path: string) => void }) {
  return (
    <article className="list-row clickable" onClick={() => onOpenPath(reminder.sourceNotePath || reminder.relativePath)}>
      <div>
        <div className="meta-row">
          <Badge value={reminder.status} tone={reminder.status} />
          <span className="meta">
            {projectName(dashboard.projects, reminder.project)} / {reminder.reminderDate} {reminder.reminderTime}
          </span>
        </div>
        <h3>{reminder.title}</h3>
      </div>
      <span className="file-icon">T</span>
    </article>
  );
}

function ProjectCard({ project, onOpen }: { project: Dashboard['projects'][number]; onOpen: (slug: string) => void }) {
  return (
    <article className="card clickable" onClick={() => onOpen(project.projectSlug)}>
      <div className="card-kicker">{project.workspaceSlug || 'default'}</div>
      <h3>{project.displayName}</h3>
      <p>{project.repoFullName}</p>
      <div className="meta-row">
        <Badge value={project.enabled ? 'active' : 'archived'} tone={project.enabled ? 'active' : 'archived'} />
        <span className="meta">{project.defaultTags.slice(0, 2).join(' / ')}</span>
      </div>
    </article>
  );
}

function HomePage({ dashboard, setView, openNote, openReview }: PageProps) {
  const latest = dashboard.notes.slice(0, 3);
  const activeReminders = dashboard.reminders.filter((reminder) => ['open', 'active'].includes(reminder.status));
  const openReviews = dashboard.reviews.filter((review) => review.findings.some((finding) => finding.status === 'open'));
  return (
    <>
      <PageHead title="Vault Home" subtitle="Leitura rapida do workspace: projetos principais, entradas recentes e itens que pedem atencao." />
      <section className="grid cols-2">
        <Panel>
          <h2>Projetos principais</h2>
          <div className="compact-grid">{dashboard.projects.slice(0, 3).map((project) => <ProjectCard key={project.projectSlug} project={project} onOpen={() => setView('projects')} />)}</div>
        </Panel>
        <Panel>
          <h2>Ultimas entradas</h2>
          <div className="list">{latest.map((note) => <NoteRow key={note.id} note={note} dashboard={dashboard} onOpen={openNote} />)}</div>
        </Panel>
        <Panel>
          <h2>Reviews abertos</h2>
          <div className="list">{openReviews.map((review) => <ReviewRow key={review.id} review={review} dashboard={dashboard} onOpen={openReview} />)}</div>
        </Panel>
        <Panel>
          <h2>Lembretes ativos</h2>
          <div className="list">{activeReminders.map((reminder) => <ReminderRow key={reminder.id} reminder={reminder} dashboard={dashboard} onOpenPath={() => setView('reminders')} />)}</div>
        </Panel>
      </section>
    </>
  );
}

type PageProps = {
  dashboard: Dashboard;
  selectedProject: string;
  selectedNoteId: string;
  selectedReviewId: string;
  setView: (view: View) => void;
  setSelectedProject: (slug: string) => void;
  openNote: (id: string) => void;
  openReview: (id: string) => void;
};

function ProjectsPage({ dashboard, selectedProject, setSelectedProject, openNote }: PageProps) {
  const selected = dashboard.projects.find((project) => project.projectSlug === selectedProject) || dashboard.projects[0];
  const notes = dashboard.notes.filter((note) => !selected || note.project === selected.projectSlug);
  return (
    <>
      <PageHead title="Projetos" subtitle="Timeline de conhecimento por repositorio e atividade recente." />
      <section className="grid cols-3">{dashboard.projects.map((project) => <ProjectCard key={project.projectSlug} project={project} onOpen={setSelectedProject} />)}</section>
      {selected ? (
        <Panel className="spaced">
          <div className="page-head">
            <div>
              <h2>{selected.displayName}</h2>
              <p>{selected.repoFullName}</p>
            </div>
            <Tags items={selected.defaultTags} />
          </div>
          <div className="timeline">{notes.map((note) => <div className="timeline-item" key={note.id}><NoteRow note={note} dashboard={dashboard} onOpen={openNote} /></div>)}</div>
        </Panel>
      ) : null}
    </>
  );
}

function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <div className="markdown">
      {markdown.split('\n').map((line, index) => {
        if (line.startsWith('# ')) return <h1 key={index}>{line.slice(2)}</h1>;
        if (line.startsWith('## ')) return <h2 key={index}>{line.slice(3)}</h2>;
        if (line.startsWith('- ')) return <p key={index}>• {line.slice(2)}</p>;
        if (!line.trim()) return null;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function VaultPage({ dashboard, selectedProject, selectedNoteId, openNote }: PageProps) {
  const notes = dashboard.notes.filter((note) => !selectedProject || note.project === selectedProject);
  const noteQuery = useQuery({ queryKey: ['note', selectedNoteId], queryFn: () => fetchNote(selectedNoteId), enabled: Boolean(selectedNoteId) });
  return (
    <>
      <PageHead title="Vault Explorer" subtitle="Arvore de arquivos, lista de documentos e leitor Markdown para exploracao rapida." />
      <div className="split">
        <aside className="document-list">{notes.map((note) => <NoteRow key={note.id} note={note} dashboard={dashboard} onOpen={openNote} />)}</aside>
        <article className="note-reader">
          {noteQuery.data ? (
            <>
              <div className="meta-row">
                <Badge value={noteQuery.data.type} />
                <Badge value={noteQuery.data.status} tone={noteQuery.data.status} />
                <span className="meta">{noteQuery.data.date}</span>
              </div>
              <h1 className="note-title">{noteQuery.data.title}</h1>
              <div className="path">{noteQuery.data.path}</div>
              <MarkdownView markdown={noteQuery.data.markdown} />
            </>
          ) : (
            <EmptyState>Selecione uma nota para abrir o leitor.</EmptyState>
          )}
        </article>
      </div>
    </>
  );
}

function ReviewsPage({ dashboard, selectedReviewId, openReview }: PageProps) {
  const selected = dashboard.reviews.find((review) => review.id === selectedReviewId) || dashboard.reviews[0];
  return (
    <>
      <PageHead title="AI Review Detail" subtitle="Resumo do push, findings por severidade, arquivos afetados e nota gerada." />
      <div className="split">
        <aside className="document-list">{dashboard.reviews.map((review) => <ReviewRow key={review.id} review={review} dashboard={dashboard} onOpen={openReview} />)}</aside>
        <Panel>
          {selected ? (
            <>
              <div className="meta-row"><Badge value={selected.status} tone={selected.status} /><span className="meta">{selected.repo || selected.project} / {selected.branch} / {selected.date}</span></div>
              <h1>{selected.title}</h1>
              <p>{selected.summary}</p>
              <h2>Impacto</h2>
              <p>{selected.impact || 'Sem impacto registrado.'}</p>
              <h2>Findings</h2>
              <div className="list">{selected.findings.map((finding, index) => <article className="finding" key={`${finding.file}-${index}`}><div className="finding-top"><strong>{finding.summary}</strong><Badge value={finding.severity} tone={finding.severity} /></div><div className="path">{finding.file}{finding.line ? `:${finding.line}` : ''}</div><p>{finding.recommendation}</p></article>)}</div>
              <h2 className="section-spaced">Arquivos afetados</h2>
              <Tags items={selected.changedFiles} />
              <h2 className="section-spaced">Nota gerada</h2>
              <div className="path">{selected.generatedNotePath}</div>
            </>
          ) : <EmptyState>Nenhum review encontrado.</EmptyState>}
        </Panel>
      </div>
    </>
  );
}

function SearchPage({ dashboard, openNote }: PageProps) {
  const [query, setQuery] = useState('timeout webhook deploy');
  const [projectSlug, setProjectSlug] = useState('');
  const result = useQuery({ queryKey: ['search', query, projectSlug], queryFn: () => runQuery({ query, projectSlug, limit: 8 }), enabled: Boolean(query.trim()) });
  const noteByPath = new Map(dashboard.notes.map((note) => [note.path, note]));
  return (
    <>
      <PageHead title="Busca" subtitle="Consulta deterministica e semantica sobre notas, paths citados e resposta consolidada." />
      <section className="search-box">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex: riscos do ultimo push no n8n" type="search" />
        <div className="filters">
          <select><option>{dashboard.workspaces[0]?.workspaceSlug || 'default'}</option></select>
          <select value={projectSlug} onChange={(event) => setProjectSlug(event.target.value)}>
            <option value="">Todos os projetos</option>
            {dashboard.projects.map((project) => <option value={project.projectSlug} key={project.projectSlug}>{project.displayName}</option>)}
          </select>
          <button className="icon-button" type="button" onClick={() => void result.refetch()}>Buscar</button>
        </div>
      </section>
      <section className="grid cols-2">
        <Panel><h2>Resposta consolidada</h2><p>{result.data?.answer.answer || 'Digite uma busca para consultar o vault.'}</p><div className="list">{result.data?.answer.citedPaths.slice(0, 3).map((path) => <div className="path" key={path}>{path}</div>)}</div></Panel>
        <Panel><h2>Resultados</h2><div className="list">{result.data?.matches.map((match) => {
          const note = noteByPath.get(match.path);
          return note ? <NoteRow key={match.path} note={note} dashboard={dashboard} onOpen={openNote} /> : <div className="path clickable" key={match.path}>{match.path} / score {match.score}</div>;
        }) || <EmptyState>Tente outro termo ou remova filtros.</EmptyState>}</div></Panel>
      </section>
    </>
  );
}

function RemindersPage({ dashboard }: PageProps) {
  const grouped = dashboard.reminders.reduce<Record<string, Reminder[]>>((acc, reminder) => {
    acc[reminder.reminderDate || 'sem-data'] ||= [];
    acc[reminder.reminderDate || 'sem-data'].push(reminder);
    return acc;
  }, {});
  return (
    <>
      <PageHead title="Lembretes" subtitle="Reminders ativos e vencidos por data, projeto, status e nota original." />
      <div className="grid">{Object.entries(grouped).map(([date, reminders]) => <Panel key={date}><h2>{date}</h2><div className="list">{reminders.map((reminder) => <ReminderRow key={reminder.id} reminder={reminder} dashboard={dashboard} onOpenPath={() => undefined} />)}</div></Panel>)}</div>
    </>
  );
}

function AppShell() {
  const [view, setView] = useState<View>('home');
  const dashboardQuery = useQuery({ queryKey: ['dashboard'], queryFn: fetchDashboard });
  const dashboard = dashboardQuery.data;
  const [selectedProject, setSelectedProject] = useState('n8n-automations');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState('');

  const pageProps = useMemo(() => dashboard ? {
    dashboard,
    selectedProject,
    selectedNoteId: selectedNoteId || dashboard.notes[0]?.id || '',
    selectedReviewId: selectedReviewId || dashboard.reviews[0]?.id || '',
    setView,
    setSelectedProject,
    openNote: (id: string) => { setSelectedNoteId(id); setView('vault'); },
    openReview: (id: string) => { setSelectedReviewId(id); setView('reviews'); },
  } : null, [dashboard, selectedProject, selectedNoteId, selectedReviewId]);

  if (!dashboard || !pageProps) return <div className="boot-state">Carregando Knowledge Vault...</div>;

  const views = {
    home: <HomePage {...pageProps} />,
    projects: <ProjectsPage {...pageProps} />,
    vault: <VaultPage {...pageProps} />,
    reviews: <ReviewsPage {...pageProps} />,
    search: <SearchPage {...pageProps} />,
    reminders: <RemindersPage {...pageProps} />,
  };

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Navegacao do vault">
        <div className="brand"><div className="brand-mark">KV</div><div><strong>Knowledge Vault</strong><span>developer knowledge base</span></div></div>
        <nav className="main-nav" aria-label="Secoes principais">{(['home', 'projects', 'vault', 'reviews', 'search', 'reminders'] as View[]).map((item) => <button className={`nav-item ${view === item ? 'active' : ''}`} key={item} onClick={() => setView(item)} type="button">{({ home: 'Home', projects: 'Projetos', vault: 'Vault', reviews: 'Reviews IA', search: 'Busca', reminders: 'Lembretes' } as Record<View, string>)[item]}</button>)}</nav>
        <section className="sidebar-section"><div className="section-label">Workspace</div><button className="workspace-pill" type="button"><span className="status-dot" />{dashboard.workspaces[0]?.workspaceSlug || 'default'}</button></section>
        <section className="sidebar-section"><div className="section-label">Projetos</div><div className="tree">{dashboard.projects.map((project) => <button className={`tree-item ${project.projectSlug === selectedProject ? 'active' : ''}`} type="button" key={project.projectSlug} onClick={() => { setSelectedProject(project.projectSlug); setView('projects'); }}><span className="file-icon">P</span><span>{project.displayName}</span></button>)}</div></section>
      </aside>
      <main className="content">
        <header className="topbar"><label className="command-bar"><span>&gt;_</span><input type="search" placeholder="Buscar notas, reviews, paths ou tags" onKeyDown={(event) => { if (event.key === 'Enter') setView('search'); }} /></label><div className="topbar-meta"><span>{dashboard.notes.length} docs</span><span>sync local</span></div></header>
        <section className="view" aria-live="polite">{views[view]}</section>
      </main>
      <aside className="inspector" aria-label="Contexto da nota"><Inspector dashboard={dashboard} selectedProject={selectedProject} selectedNoteId={pageProps.selectedNoteId} selectedReviewId={pageProps.selectedReviewId} view={view} /></aside>
    </div>
  );
}

function Inspector({ dashboard, selectedProject, selectedNoteId, selectedReviewId, view }: { dashboard: Dashboard; selectedProject: string; selectedNoteId: string; selectedReviewId: string; view: View }) {
  const note = dashboard.notes.find((item) => item.id === selectedNoteId);
  const review = dashboard.reviews.find((item) => item.id === selectedReviewId);
  const project = dashboard.projects.find((item) => item.projectSlug === selectedProject);
  return (
    <div>
      <div className="inspector-block"><h2>Workspace</h2><dl><dt>Nome</dt><dd>{dashboard.workspaces[0]?.displayName || 'Default Workspace'}</dd><dt>Canais</dt><dd>{dashboard.workspaces[0]?.githubRepos.join(', ') || 'local'}</dd></dl></div>
      <div className="inspector-block"><h2>Projeto selecionado</h2><dl><dt>Nome</dt><dd>{project?.displayName || ''}</dd><dt>Repo</dt><dd>{project?.repoFullName || ''}</dd></dl></div>
      {view === 'reviews' && review ? <div className="inspector-block"><h2>Review IA</h2><dl><dt>Repo</dt><dd>{review.repo}</dd><dt>Branch</dt><dd>{review.branch}</dd><dt>Findings</dt><dd>{review.findings.length}</dd></dl></div> : null}
      {note ? <div className="inspector-block"><h2>Nota atual</h2><dl><dt>Projeto</dt><dd>{projectName(dashboard.projects, note.project)}</dd><dt>Tipo</dt><dd>{note.type}</dd><dt>Status</dt><dd>{note.status}</dd><dt>Origem</dt><dd>{note.source}</dd></dl></div> : null}
      <div className="inspector-block"><h2>Acoes rapidas</h2><div className="toolbar"><button className="icon-button" type="button">Abrir nota</button><button className="filter-chip" type="button">Buscar relacionados</button></div></div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  </StrictMode>,
);
