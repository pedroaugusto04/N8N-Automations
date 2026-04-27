export type IntegrationStatusValue = 'connected' | 'partial' | 'missing';

export type IntegrationStatus = {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatusValue;
  requiredEnv: string[];
  configuredEnv: string[];
  missingEnv: string[];
  links: Array<{
    label: string;
    url: string;
    external: boolean;
  }>;
  checklist: string[];
  warnings: string[];
};

export type IntegrationsResponse = {
  ok: true;
  workspaceSlug: string;
  integrations: IntegrationStatus[];
};
