import type { I18nKey } from '../../i18n';
import type { LanguageMode } from '../../types';

interface StudentOverviewSectionProps {
  t: (key: I18nKey) => string;
  taskTitle: string;
  taskDescription: string;
  defaultLanguageMode: LanguageMode;
  displayNameDraft: string;
  busy: boolean;
  onDisplayNameChange: (value: string) => void;
  onSaveDisplayName: () => void;
}

export function StudentOverviewSection({
  t,
  taskTitle,
  taskDescription,
  defaultLanguageMode,
  displayNameDraft,
  busy,
  onDisplayNameChange,
  onSaveDisplayName
}: StudentOverviewSectionProps) {
  return (
    <section className="panel hero panel-animate">
      <h2>{t('currentTask')}</h2>
      <h3>{taskTitle}</h3>
      <p>{taskDescription}</p>

      <div className="chip-row">
        <span className="chip">
          {t('defaultMode')}: {defaultLanguageMode}
        </span>
        <span className="chip">{t('feedLimited')}</span>
      </div>

      <div className="split-grid">
        <label>
          <span>{t('displayName')}</span>
          <input
            className="input"
            value={displayNameDraft}
            onChange={(event) => onDisplayNameChange(event.target.value)}
          />
        </label>

        <button
          className="button"
          type="button"
          onClick={onSaveDisplayName}
          disabled={busy}
        >
          {t('save')}
        </button>
      </div>
    </section>
  );
}
