import type { Project } from '../../domain/projects.js';
import type { Workspace } from '../../domain/workspaces.js';

export type VaultNoteSummary = {
  id: string;
  path: string;
  type: string;
  title: string;
  project: string;
  workspace: string;
  tags: string[];
  date: string;
  status: string;
  summary: string;
  source: string;
};

export type VaultNoteDetail = VaultNoteSummary & {
  markdown: string;
  frontmatter: Record<string, unknown>;
  links: string[];
  origin: string;
};

export type ReviewFindingView = {
  severity: string;
  file: string;
  line: number;
  summary: string;
  recommendation: string;
  status: string;
};

export type ReviewView = {
  id: string;
  title: string;
  repo: string;
  project: string;
  branch: string;
  date: string;
  status: string;
  summary: string;
  impact: string;
  changedFiles: string[];
  generatedNotePath: string;
  findings: ReviewFindingView[];
};

export type ReminderView = {
  id: string;
  title: string;
  project: string;
  status: string;
  reminderDate: string;
  reminderTime: string;
  reminderAt: string;
  relativePath: string;
  sourceNotePath: string;
};

export type DashboardView = {
  workspaces: Workspace[];
  projects: Project[];
  notes: VaultNoteSummary[];
  reviews: ReviewView[];
  reminders: ReminderView[];
};

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
