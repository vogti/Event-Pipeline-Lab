import type { I18nKey } from '../../i18n';
import type { ExternalStreamSource, TimestampValue } from '../../types';

interface AdminStreamSourcesSectionProps {
  t: (key: I18nKey) => string;
  sources: ExternalStreamSource[];
  endpointDrafts: Record<string, string>;
  busyKey: string | null;
  formatTs: (value: TimestampValue) => string;
  onEndpointDraftChange: (sourceId: string, value: string) => void;
  onToggleEnabled: (sourceId: string, enabled: boolean) => void;
  onSaveConfig: (sourceId: string) => void;
  onResetCounter: (sourceId: string) => void;
}

export function AdminStreamSourcesSection({
  t,
  sources,
  endpointDrafts,
  busyKey,
  formatTs,
  onEndpointDraftChange,
  onToggleEnabled,
  onSaveConfig,
  onResetCounter
}: AdminStreamSourcesSectionProps) {
  return (
    <section className="panel panel-animate full-width stream-sources-panel">
      <header className="panel-header">
        <h2>{t('streamSources')}</h2>
      </header>
      {sources.length === 0 ? (
        <p className="muted">{t('streamSourcesNone')}</p>
      ) : (
        <div className="stream-source-grid">
          {sources.map((source) => {
            const endpointDraft = endpointDrafts[source.sourceId] ?? source.endpointUrl;
            const toggleBusy = busyKey === `stream-source-toggle-${source.sourceId}`;
            const configBusy = busyKey === `stream-source-config-${source.sourceId}`;
            const resetBusy = busyKey === `stream-source-reset-${source.sourceId}`;
            return (
              <article key={source.sourceId} className="stream-source-card">
                <header className="stream-source-card-header">
                  <div>
                    <h3>{source.displayName}</h3>
                    <div className="muted stream-source-id">{source.sourceId}</div>
                  </div>
                  <span className={`status-indicator ${source.online ? 'online' : 'offline'}`}>
                    {source.online ? t('online') : t('offline')}
                  </span>
                </header>

                <div className="stream-source-controls">
                  <label>
                    <span>{t('streamSourceEndpoint')}</span>
                    <input
                      className="input"
                      value={endpointDraft}
                      onChange={(event) => onEndpointDraftChange(source.sourceId, event.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onSaveConfig(source.sourceId)}
                    disabled={configBusy}
                  >
                    {t('save')}
                  </button>
                </div>

                <div className="stream-source-controls">
                  <label>
                    <span>{t('streamSourceEventsSinceReset')}</span>
                    <div className="stream-source-counter">{source.eventsSinceReset}</div>
                  </label>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => onResetCounter(source.sourceId)}
                    disabled={resetBusy}
                  >
                    {t('streamSourceResetCounter')}
                  </button>
                </div>

                <div className="stream-source-meta">
                  <div>
                    <span>{t('streamSourceLastConnected')}</span>
                    <strong>{formatTs(source.lastConnectedAt)}</strong>
                  </div>
                  <div>
                    <span>{t('streamSourceLastEvent')}</span>
                    <strong>{formatTs(source.lastEventAt)}</strong>
                  </div>
                  <div>
                    <span>{t('streamSourceCheckedAt')}</span>
                    <strong>{formatTs(source.statusCheckedAt)}</strong>
                  </div>
                  <div>
                    <span>{t('streamSourceLastError')}</span>
                    <strong>{source.lastError?.trim() ? source.lastError : '-'}</strong>
                  </div>
                </div>

                <div className="stream-source-actions">
                  <button
                    className={`button ${source.enabled ? 'danger' : ''}`}
                    type="button"
                    onClick={() => onToggleEnabled(source.sourceId, !source.enabled)}
                    disabled={toggleBusy}
                  >
                    {source.enabled ? t('streamSourceDisable') : t('streamSourceEnable')}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
