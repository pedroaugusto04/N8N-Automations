export type Project = {
  projectSlug: string;
  displayName: string;
  repoFullName: string;
  workspaceSlug: string;
  aliases: string[];
  defaultTags: string[];
  enabled: boolean;
};

export type Workspace = {
  workspaceSlug: string;
  displayName: string;
  githubRepos: string[];
  projectSlugs: string[];
};

export type NoteSummary = {
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

export type NoteDetail = NoteSummary & {
  markdown: string;
  frontmatter: Record<string, unknown>;
  links: string[];
  origin: string;
};

export type Review = {
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
  findings: Array<{
    severity: string;
    file: string;
    line: number;
    summary: string;
    recommendation: string;
    status: string;
  }>;
};

export type Reminder = {
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

export type Dashboard = {
  workspaces: Workspace[];
  projects: Project[];
  notes: NoteSummary[];
  reviews: Review[];
  reminders: Reminder[];
};

export type QueryResponse = {
  ok: boolean;
  mode: string;
  query: string;
  matches: Array<{
    path: string;
    title: string;
    projectSlug: string;
    score: number;
    snippet: string;
  }>;
  answer: {
    answer: string;
    bullets: string[];
    citedPaths: string[];
  };
};
