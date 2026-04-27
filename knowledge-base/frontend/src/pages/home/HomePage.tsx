import type { PageContext } from '../../app/page-context';
import { PageHead, Panel } from '../../shared/ui/primitives';
import { NoteRow } from '../../widgets/notes/NoteRow';
import { ProjectCard } from '../../widgets/projects/ProjectCard';
import { ReminderRow } from '../../widgets/reminders/ReminderRow';
import { ReviewRow } from '../../widgets/reviews/ReviewRow';

export function HomePage({ dashboard, openNote, openReview, setSelectedProject }: PageContext) {
  const latest = dashboard.notes.slice(0, 3);
  const activeReminders = dashboard.reminders.filter((reminder) => ['open', 'active'].includes(reminder.status));
  const openReviews = dashboard.reviews.filter((review) => review.findings.some((finding) => finding.status === 'open'));

  return (
    <>
      <PageHead title="Vault Home" subtitle="Leitura rapida do workspace: projetos principais, entradas recentes e itens que pedem atencao." />
      <section className="grid cols-2">
        <Panel>
          <h2>Projetos principais</h2>
          <div className="compact-grid">
            {dashboard.projects.slice(0, 3).map((project) => (
              <ProjectCard key={project.projectSlug} project={project} onOpen={setSelectedProject} />
            ))}
          </div>
        </Panel>
        <Panel>
          <h2>Ultimas entradas</h2>
          <div className="list">
            {latest.map((note) => (
              <NoteRow key={note.id} note={note} dashboard={dashboard} onOpen={openNote} />
            ))}
          </div>
        </Panel>
        <Panel>
          <h2>Reviews abertos</h2>
          <div className="list">
            {openReviews.map((review) => (
              <ReviewRow key={review.id} review={review} dashboard={dashboard} onOpen={openReview} />
            ))}
          </div>
        </Panel>
        <Panel>
          <h2>Lembretes ativos</h2>
          <div className="list">
            {activeReminders.map((reminder) => (
              <ReminderRow key={reminder.id} reminder={reminder} dashboard={dashboard} onOpenPath={() => undefined} />
            ))}
          </div>
        </Panel>
      </section>
    </>
  );
}
