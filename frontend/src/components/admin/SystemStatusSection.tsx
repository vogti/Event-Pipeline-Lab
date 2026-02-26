import type { I18nKey, Language } from '../../i18n';
import {
  formatBytes,
  formatMinuteTimestamp,
  SYSTEM_DATA_PART_ORDER,
  systemDataPartLabel
} from '../../app/shared';
import type {
  AdminSystemStatus,
  SystemDataImportVerifyResponse,
  SystemDataPart,
  SystemStatusEventRatePoint,
  TimestampValue
} from '../../types';

interface SystemStatusSectionProps {
  t: (key: I18nKey) => string;
  language: Language;
  timeFormat24h: boolean;
  busyKey: string | null;
  adminSystemStatus: AdminSystemStatus | null;
  systemStatusSeries: SystemStatusEventRatePoint[];
  systemStatusMaxEventCount: number;
  systemStatusRamUsagePct: number | null;
  formatTs: (value: TimestampValue) => string;
  refreshAdminData: () => void;
  onOpenResetEventsModal: () => void;
  systemDataExportSelection: Record<SystemDataPart, boolean>;
  onToggleSystemDataExportPart: (part: SystemDataPart, checked: boolean) => void;
  onExportSystemData: () => void;
  selectedSystemDataExportPartsCount: number;
  systemDataImportFileName: string;
  onSystemImportFileSelected: (file: File) => void;
  onVerifySystemImport: () => void;
  onApplySystemImport: () => void;
  systemDataImportFilePresent: boolean;
  systemDataImportVerify: SystemDataImportVerifyResponse | null;
  systemDataImportSelection: Record<SystemDataPart, boolean>;
  onToggleSystemDataImportPart: (part: SystemDataPart, checked: boolean) => void;
  selectedSystemDataImportPartsCount: number;
}

export function SystemStatusSection({
  t,
  language,
  timeFormat24h,
  busyKey,
  adminSystemStatus,
  systemStatusSeries,
  systemStatusMaxEventCount,
  systemStatusRamUsagePct,
  formatTs,
  refreshAdminData,
  onOpenResetEventsModal,
  systemDataExportSelection,
  onToggleSystemDataExportPart,
  onExportSystemData,
  selectedSystemDataExportPartsCount,
  systemDataImportFileName,
  onSystemImportFileSelected,
  onVerifySystemImport,
  onApplySystemImport,
  systemDataImportFilePresent,
  systemDataImportVerify,
  systemDataImportSelection,
  onToggleSystemDataImportPart,
  selectedSystemDataImportPartsCount
}: SystemStatusSectionProps) {
  return (
    <section className="panel panel-animate full-width system-status-panel">
      <div className="panel-header">
        <h2>{t('systemStatus')}</h2>
        <button
          className="button secondary"
          type="button"
          onClick={refreshAdminData}
          disabled={busyKey === 'admin-refresh' || busyKey === 'admin-reset-events'}
        >
          {t('refresh')}
        </button>
      </div>

      {!adminSystemStatus ? (
        <p className="muted">{t('loading')}</p>
      ) : (
        <>
          <div className="system-status-grid">
            <article className="system-status-card">
              <h3>{t('eventsLast10Minutes')}</h3>
              <div className="system-status-chart">
                {systemStatusSeries.map((point) => {
                  const heightPct =
                    systemStatusMaxEventCount <= 0 || point.eventCount <= 0
                      ? 0
                      : Math.max(6, Math.round((point.eventCount / systemStatusMaxEventCount) * 100));
                  const timeLabel = formatMinuteTimestamp(point.minuteTs, language, timeFormat24h);
                  return (
                    <div className="system-status-bar-column" key={String(point.minuteTs)}>
                      <span className="system-status-bar-value">{point.eventCount}</span>
                      <div className="system-status-bar-track">
                        <span className="system-status-bar-fill" style={{ height: `${heightPct}%` }} />
                      </div>
                      <span className="system-status-bar-label">{timeLabel}</span>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="system-status-card">
              <h3>{t('cpuLoad')}</h3>
              <p className="system-status-value">
                {adminSystemStatus.cpuLoadPct === null ? '-' : `${adminSystemStatus.cpuLoadPct.toFixed(1)}%`}
              </p>
              <h3>{t('ramUsage')}</h3>
              <p className="system-status-value">
                {adminSystemStatus.ramUsedBytes === null || adminSystemStatus.ramTotalBytes === null
                  ? '-'
                  : `${formatBytes(adminSystemStatus.ramUsedBytes, language)} / ${formatBytes(adminSystemStatus.ramTotalBytes, language)}`}
              </p>
              {systemStatusRamUsagePct !== null ? (
                <div className="system-status-progress">
                  <span style={{ width: `${systemStatusRamUsagePct.toFixed(1)}%` }} />
                </div>
              ) : null}
            </article>

            <article className="system-status-card">
              <h3>{t('databaseSize')}</h3>
              <button
                className="button secondary system-status-db-button"
                type="button"
                onClick={onOpenResetEventsModal}
              >
                {formatBytes(adminSystemStatus.postgresSizeBytes, language)}
              </button>
              <p className="muted">{t('resetStoredEvents')}</p>
            </article>

            <article className="system-status-card">
              <h3>{t('websocketSessions')}</h3>
              <div className="system-status-sessions">
                <div className="system-status-session-row">
                  <span>{t('wsAdmin')}</span>
                  <strong>{adminSystemStatus.websocketSessions.admin}</strong>
                </div>
                <div className="system-status-session-row">
                  <span>{t('wsStudent')}</span>
                  <strong>{adminSystemStatus.websocketSessions.student}</strong>
                </div>
                <div className="system-status-session-row">
                  <span>{t('wsTotal')}</span>
                  <strong>{adminSystemStatus.websocketSessions.total}</strong>
                </div>
              </div>
              <p className="muted">{formatTs(adminSystemStatus.generatedAt)}</p>
            </article>
          </div>

          <div className="system-transfer-grid">
            <article className="system-status-card system-transfer-card">
              <h3>{t('systemDataExport')}</h3>
              <p className="muted">{t('systemDataSelectParts')}</p>
              <div className="system-transfer-parts">
                {SYSTEM_DATA_PART_ORDER.map((part) => (
                  <label key={`export-${part}`} className="checkbox-inline system-transfer-part">
                    <input
                      type="checkbox"
                      checked={systemDataExportSelection[part]}
                      onChange={(event) => onToggleSystemDataExportPart(part, event.target.checked)}
                      disabled={busyKey === 'admin-system-export'}
                    />
                    <span>{systemDataPartLabel(part, t)}</span>
                  </label>
                ))}
              </div>
              <button
                className="button"
                type="button"
                onClick={onExportSystemData}
                disabled={busyKey === 'admin-system-export' || selectedSystemDataExportPartsCount === 0}
              >
                {t('systemDataExportAction')}
              </button>
            </article>

            <article className="system-status-card system-transfer-card">
              <h3>{t('systemDataImport')}</h3>
              <label className="system-transfer-file">
                <span>{t('systemDataImportFile')}</span>
                <input
                  className="input"
                  type="file"
                  accept="application/zip,.zip,application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      return;
                    }
                    onSystemImportFileSelected(file);
                  }}
                  disabled={busyKey === 'admin-system-import-verify' || busyKey === 'admin-system-import-apply'}
                />
              </label>
              {systemDataImportFileName ? <p className="muted mono">{systemDataImportFileName}</p> : null}
              <div className="system-transfer-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={onVerifySystemImport}
                  disabled={
                    busyKey === 'admin-system-import-verify' ||
                    busyKey === 'admin-system-import-apply' ||
                    !systemDataImportFilePresent
                  }
                >
                  {t('systemDataVerifyAction')}
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={onApplySystemImport}
                  disabled={
                    busyKey === 'admin-system-import-verify' ||
                    busyKey === 'admin-system-import-apply' ||
                    !systemDataImportVerify?.valid ||
                    selectedSystemDataImportPartsCount === 0
                  }
                >
                  {t('systemDataApplyAction')}
                </button>
              </div>

              {systemDataImportVerify ? (
                <div className="system-transfer-verify">
                  <p className="muted">
                    {systemDataImportVerify.valid ? t('systemDataImportValid') : t('systemDataImportInvalid')}
                    {systemDataImportVerify.exportedAt
                      ? ` - ${formatTs(systemDataImportVerify.exportedAt)}`
                      : ''}
                  </p>
                  {systemDataImportVerify.warnings.length > 0 ? (
                    <div>
                      <strong>{t('systemDataImportWarnings')}</strong>
                      <ul className="system-transfer-warnings">
                        {systemDataImportVerify.warnings.map((warning, index) => (
                          <li key={`import-warning-${index}`}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {systemDataImportVerify.errors.length > 0 ? (
                    <div>
                      <strong>{t('systemDataImportErrors')}</strong>
                      <ul className="system-transfer-errors">
                        {systemDataImportVerify.errors.map((error, index) => (
                          <li key={`import-error-${index}`}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <strong>{t('systemDataImportContains')}</strong>
                  {systemDataImportVerify.availableParts.length === 0 ? (
                    <p className="muted">{t('systemDataImportNoSupportedParts')}</p>
                  ) : (
                    <div className="system-transfer-parts">
                      {systemDataImportVerify.availableParts.map((entry) => (
                        <label key={`import-${entry.part}`} className="checkbox-inline system-transfer-part">
                          <input
                            type="checkbox"
                            checked={systemDataImportSelection[entry.part]}
                            onChange={(event) => onToggleSystemDataImportPart(entry.part, event.target.checked)}
                            disabled={!systemDataImportVerify.valid || busyKey === 'admin-system-import-apply'}
                          />
                          <span>
                            {systemDataPartLabel(entry.part, t)} ({entry.rowCount})
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          </div>
        </>
      )}
    </section>
  );
}
