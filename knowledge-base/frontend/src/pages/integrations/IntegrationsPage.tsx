import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchIntegrations } from '../../shared/api/client';
import type { IntegrationStatus, IntegrationStatusValue } from '../../shared/api/models/integration';
import { Badge, EmptyState, PageHead, Panel, Tags } from '../../shared/ui/primitives';

const statusLabel: Record<IntegrationStatusValue, string> = {
  connected: 'conectado',
  partial: 'parcial',
  missing: 'pendente',
};

const statusTone: Record<IntegrationStatusValue, string> = {
  connected: 'low',
  partial: 'medium',
  missing: 'high',
};

const integrationLogos: Record<string, { src: string; label: string }> = {
  'github-app': { src: 'https://cdn.simpleicons.org/github/ffffff', label: 'GitHub' },
  webhooks: { src: 'https://cdn.simpleicons.org/n8n/EA4B71', label: 'n8n' },
  whatsapp: { src: 'https://cdn.simpleicons.org/whatsapp/25D366', label: 'WhatsApp' },
  telegram: { src: 'https://cdn.simpleicons.org/telegram/26A5E4', label: 'Telegram' },
  ai: { src: 'https://cdn.simpleicons.org/openrouter/ffffff', label: 'OpenRouter' },
  'vault-git': { src: 'https://cdn.simpleicons.org/git/F05032', label: 'Git' },
};

function IntegrationLogo({ integration }: { integration: IntegrationStatus }) {
  const logo = integrationLogos[integration.id];
  if (!logo) return <div className="integration-logo-fallback">{integration.name.slice(0, 2).toUpperCase()}</div>;
  return <img alt={`${logo.label} logo`} className="integration-logo" src={logo.src} />;
}

function IntegrationDetailsModal({ integration, onClose }: { integration: IntegrationStatus; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="integration-details-title"
        aria-modal="true"
        className="modal-panel integration-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div className="integration-modal-title">
            <IntegrationLogo integration={integration} />
            <div>
              <div className="card-kicker">{integration.id}</div>
              <h2 id="integration-details-title">{integration.name}</h2>
            </div>
          </div>
          <button aria-label="Fechar detalhes" className="modal-close" type="button" onClick={onClose}>
            x
          </button>
        </div>

        <p>{integration.description}</p>

        <div className="integration-section">
          <h3>Checklist</h3>
          <ul className="checklist">
            {integration.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        {integration.missingEnv.length > 0 ? (
          <div className="integration-section">
            <h3>Variaveis ausentes</h3>
            <Tags items={integration.missingEnv} />
          </div>
        ) : null}

        {integration.configuredEnv.length > 0 ? (
          <div className="integration-section">
            <h3>Configuradas</h3>
            <Tags items={integration.configuredEnv} />
          </div>
        ) : null}

        {integration.links.length > 0 ? (
          <div className="integration-section">
            <h3>URLs</h3>
            <div className="integration-links">
              {integration.links.map((item) => (
                <a className="integration-link" href={item.url} key={`${item.label}:${item.url}`} rel="noreferrer" target={item.external ? '_blank' : undefined}>
                  <span>{item.label}</span>
                  <code>{item.url}</code>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {integration.warnings.length > 0 ? (
          <div className="integration-section">
            <h3>Atencao</h3>
            <ul className="warning-list">
              {integration.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function IntegrationCard({ integration, onInfo }: { integration: IntegrationStatus; onInfo: (integration: IntegrationStatus) => void }) {
  const pendingCount = integration.missingEnv.length + integration.warnings.length;

  return (
    <Panel className="integration-card">
      <button aria-label={`Ver detalhes de ${integration.name}`} className="integration-info-button" type="button" onClick={() => onInfo(integration)}>
        i
      </button>
      <div className="integration-card-head">
        <IntegrationLogo integration={integration} />
        <div>
          <h2>{integration.name}</h2>
          <p>{integration.description}</p>
        </div>
      </div>
      <div className="integration-card-foot">
        <Badge value={statusLabel[integration.status]} tone={statusTone[integration.status]} />
        {pendingCount > 0 ? <span className="meta">{pendingCount} pendencias</span> : <span className="meta">pronto para uso</span>}
      </div>
    </Panel>
  );
}

export function IntegrationsPage() {
  const integrationsQuery = useQuery({ queryKey: ['integrations'], queryFn: fetchIntegrations });
  const [selectedIntegration, setSelectedIntegration] = useState<IntegrationStatus | null>(null);

  if (integrationsQuery.isLoading) return <EmptyState>Carregando integracoes...</EmptyState>;
  if (!integrationsQuery.data) return <EmptyState>Nao foi possivel carregar o status das integracoes.</EmptyState>;

  return (
    <>
      <PageHead
        title="Integracoes"
        subtitle={`Status read-only do workspace ${integrationsQuery.data.workspaceSlug}. Segredos continuam no .env/infra.`}
      />
      <section className="grid cols-2 integrations-grid">
        {integrationsQuery.data.integrations.map((integration) => (
          <IntegrationCard integration={integration} key={integration.id} onInfo={setSelectedIntegration} />
        ))}
      </section>
      {selectedIntegration ? <IntegrationDetailsModal integration={selectedIntegration} onClose={() => setSelectedIntegration(null)} /> : null}
    </>
  );
}
