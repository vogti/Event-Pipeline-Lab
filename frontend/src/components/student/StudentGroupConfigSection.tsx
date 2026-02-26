import type { ReactNode } from 'react';
import type { I18nKey } from '../../i18n';
import type { TimestampValue } from '../../types';

interface StudentGroupConfigSectionProps {
  t: (key: I18nKey) => string;
  allowedConfigOptions: string[];
  configDraft: Record<string, unknown>;
  revision: number;
  updatedBy: string;
  updatedAt: TimestampValue;
  busy: boolean;
  onConfigOptionChange: (option: string, nextValue: unknown) => void;
  onSave: () => void;
  renderConfigInput: (
    option: string,
    value: unknown,
    setValue: (next: unknown) => void
  ) => ReactNode;
  formatTs: (value: TimestampValue) => string;
}

export function StudentGroupConfigSection({
  t,
  allowedConfigOptions,
  configDraft,
  revision,
  updatedBy,
  updatedAt,
  busy,
  onConfigOptionChange,
  onSave,
  renderConfigInput,
  formatTs
}: StudentGroupConfigSectionProps) {
  return (
    <section className="panel panel-animate" id="student-settings-panel">
      <h2>{t('groupConfig')}</h2>
      <div className="config-grid">
        {allowedConfigOptions.map((option) => (
          <label key={option}>
            <span>{option}</span>
            {renderConfigInput(option, configDraft[option], (next) => onConfigOptionChange(option, next))}
          </label>
        ))}
      </div>

      <div className="meta-row">
        <span>
          {t('revision')}: {revision}
        </span>
        <span>
          {t('updatedBy')}: {updatedBy}
        </span>
        <span>
          {t('lastSeen')}: {formatTs(updatedAt)}
        </span>
      </div>

      <button
        className="button"
        type="button"
        onClick={onSave}
        disabled={busy}
      >
        {t('save')}
      </button>
    </section>
  );
}
