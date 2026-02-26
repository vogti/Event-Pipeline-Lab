import type { I18nKey } from '../../i18n';
import { PipelineScenarioEditor } from './PipelineScenarioEditor';
import type { TimestampValue } from '../../types';

interface PipelineScenariosSectionProps {
  t: (key: I18nKey) => string;
  overlays: string[];
  busy: boolean;
  updatedAt: TimestampValue;
  updatedBy: string | null;
  formatTs: (value: TimestampValue) => string;
  onOverlaysChange: (scenarioOverlays: string[]) => void;
  onSave: () => void;
}

export function PipelineScenariosSection({
  t,
  overlays,
  busy,
  updatedAt,
  updatedBy,
  formatTs,
  onOverlaysChange,
  onSave
}: PipelineScenariosSectionProps) {
  return (
    <section className="panel panel-animate full-width">
      <header className="panel-header">
        <h3>{t('scenarioPipelineTitle')}</h3>
        <button
          className="button small"
          type="button"
          onClick={onSave}
          disabled={busy}
        >
          {busy ? t('loading') : t('save')}
        </button>
      </header>

      <PipelineScenarioEditor
        t={t}
        overlays={overlays}
        disabled={busy}
        onChange={onOverlaysChange}
      />

      <p className="muted">
        {t('updatedBy')}: {updatedBy ?? '-'} | {t('updatedAt')}: {formatTs(updatedAt)}
      </p>
    </section>
  );
}
