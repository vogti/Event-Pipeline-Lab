import type { I18nKey } from '../../i18n';
import { PipelineScenarioEditor } from './PipelineScenarioEditor';

interface PipelineScenariosSectionProps {
  t: (key: I18nKey) => string;
  overlays: string[];
  busy: boolean;
  onOverlaysChange: (scenarioOverlays: string[]) => void;
  onSave: () => void;
}

export function PipelineScenariosSection({
  t,
  overlays,
  busy,
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
    </section>
  );
}
