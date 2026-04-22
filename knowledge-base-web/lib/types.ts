export type ProjectOption = {
  slug: string;
  label: string;
  aliases: string[];
  description?: string;
};

export type ProxyResponse = {
  ok?: boolean;
  message?: string;
  project?: string;
  project_slug?: string;
  kind?: string;
  notePath?: string;
  reminderPath?: string;
  canonicalPath?: string;
  followupPath?: string;
  projectPath?: string;
  attachmentPath?: string;
  attachmentMode?: string;
  status?: string;
  [key: string]: unknown;
};
