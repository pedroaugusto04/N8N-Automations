import type { Project } from '../../domain/projects.js';
import type { Workspace } from '../../domain/workspaces.js';
import type { ReminderView } from '../models/reminder.models.js';
import type { ReviewView } from '../models/review.models.js';
import type { VaultNoteDetail, VaultNoteSummary } from '../models/vault-note.models.js';

export abstract class ProjectRepository {
  abstract list(): Promise<Project[]>;
}

export abstract class WorkspaceRepository {
  abstract list(): Promise<Workspace[]>;
}

export abstract class VaultNoteRepository {
  abstract list(): Promise<VaultNoteSummary[]>;
  abstract getById(id: string): Promise<VaultNoteDetail | null>;
  abstract listReviews(): Promise<ReviewView[]>;
  abstract listReminders(): Promise<ReminderView[]>;
}
