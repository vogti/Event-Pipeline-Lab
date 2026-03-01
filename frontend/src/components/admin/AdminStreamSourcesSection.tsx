import { useEffect, useMemo, useState } from 'react';
import { CloseIcon } from '../../app/shared-icons';
import type { I18nKey } from '../../i18n';
import type { ExternalStreamSource, TimestampValue } from '../../types';
import { ModalPortal } from '../layout/ModalPortal';

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
  const [configSourceId, setConfigSourceId] = useState<string | null>(null);

  const configSource = useMemo(
    () => sources.find((source) => source.sourceId === configSourceId) ?? null,
    [sources, configSourceId]
  );

  const configSourceEndpointDraft = configSource
    ? (endpointDrafts[configSource.sourceId] ?? configSource.endpointUrl)
    : '';

  useEffect(() => {
    if (!configSourceId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConfigSourceId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [configSourceId]);

  const closeConfigModal = () => {
    setConfigSourceId(null);
  };

  const saveConfigFromModal = () => {
    if (!configSource) {
      return;
    }
    onSaveConfig(configSource.sourceId);
  };

  return (
    <>
      <section className="panel panel-animate full-width stream-sources-panel">
        <header className="panel-header">
          <h2>{t('streamSources')}</h2>
        </header>
        {sources.length === 0 ? (
          <p className="muted">{t('streamSourcesNone')}</p>
        ) : (
          <div className="stream-source-grid">
            {sources.map((source) => {
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
                    <div className="stream-source-state-stack">
                      <div className="stream-source-state-row">
                        <span className="stream-source-state-label">
                          {t('streamSourceStateEnabledLabel')}
                        </span>
                        <span className={`stream-source-state-pill ${source.enabled ? 'enabled' : 'disabled'}`}>
                          {source.enabled ? t('streamSourceStateEnabled') : t('streamSourceStateDisabled')}
                        </span>
                      </div>
                      <div className="stream-source-state-row">
                        <span className="stream-source-state-label">
                          {t('streamSourceStateConnectionLabel')}
                        </span>
                        <span className={`stream-source-state-pill ${source.online ? 'online' : 'offline'}`}>
                          {source.online ? t('online') : t('offline')}
                        </span>
                      </div>
                    </div>
                  </header>

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
                      <span>{t('streamSourceEndpoint')}</span>
                      <strong className="mono">{source.endpointUrl || '-'}</strong>
                    </div>
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
                      className="button secondary tiny"
                      type="button"
                      onClick={() => setConfigSourceId(source.sourceId)}
                      disabled={configBusy}
                    >
                      {t('streamSourceConfigure')}
                    </button>
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

      {configSource ? (
        <ModalPortal>
          <div className="event-modal-backdrop" onClick={closeConfigModal}>
            <div className="event-modal stream-source-config-modal" onClick={(event) => event.stopPropagation()}>
              <div className="panel-header">
                <h2>{t('streamSourceConfigTitle')}</h2>
                <button
                  className="modal-close-button"
                  type="button"
                  onClick={closeConfigModal}
                  aria-label={t('close')}
                  title={t('close')}
                >
                  <CloseIcon />
                </button>
              </div>
              <p className="muted">{configSource.displayName}</p>
              <label>
                <span>{t('streamSourceEndpoint')}</span>
                <input
                  className="input"
                  value={configSourceEndpointDraft}
                  onChange={(event) => onEndpointDraftChange(configSource.sourceId, event.target.value)}
                />
              </label>
              <div className="event-modal-actions">
                <button className="button secondary" type="button" onClick={closeConfigModal}>
                  {t('close')}
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={saveConfigFromModal}
                  disabled={busyKey === `stream-source-config-${configSource.sourceId}`}
                >
                  {t('save')}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </>
  );
}
