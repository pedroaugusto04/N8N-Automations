export type HomeMetric = {
  id: string;
  label: string;
  value: number;
  meta: string;
  tone?: string;
};

export type HomeActivityPoint = {
  date: string;
  label: string;
  count: number;
};

export type HomeProjectActivity = {
  project: string;
  label: string;
  count: number;
};

export type HomeNavigationTarget = {
  kind: 'note' | 'review' | 'project';
  id?: string;
  path?: string;
  slug?: string;
};

export type HomePriority = {
  id: string;
  type: 'reminder' | 'finding' | 'incident' | 'followup';
  title: string;
  project: string;
  date: string;
  description: string;
  severity?: string;
  status?: string;
  target: HomeNavigationTarget;
};

export type HomeInterestingEvent = {
  id: string;
  type: string;
  title: string;
  project: string;
  date: string;
  summary: string;
  status: string;
  target: HomeNavigationTarget;
};

export type DashboardHomeSummary = {
  windowDays: number;
  metrics: HomeMetric[];
  activityByDay: HomeActivityPoint[];
  activityByProject: HomeProjectActivity[];
  priorities: HomePriority[];
  recentInterestingEvents: HomeInterestingEvent[];
};
