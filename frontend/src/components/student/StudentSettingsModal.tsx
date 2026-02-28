import type { I18nKey } from '../../i18n';
import { CloseIcon } from '../../app/shared-icons';

interface StudentSettingsModalProps {
  t: (key: I18nKey) => string;
  open: boolean;
  displayNameDraft: string;
  saveBusy: boolean;
  simplifiedView: boolean;
  onDisplayNameChange: (value: string) => void;
  onSaveDisplayName: () => void;
  onSimplifiedViewChange: (next: boolean) => void;
  onClose: () => void;
}

export function StudentSettingsModal({
  t,
  open,
  displayNameDraft,
  saveBusy,
  simplifiedView,
  onDisplayNameChange,
  onSaveDisplayName,
  onSimplifiedViewChange,
  onClose
}: StudentSettingsModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="event-modal-backdrop" onClick={onClose}>
      <div className="event-modal student-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="panel-header">
          <h2>{t('settings')}</h2>
          <button
            className="modal-close-button"
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            title={t('close')}
          >
            <CloseIcon />
          </button>
        </div>

        <label className="student-settings-field">
          <span>{t('displayName')}</span>
          <input
            className="input"
            value={displayNameDraft}
            onChange={(event) => onDisplayNameChange(event.target.value)}
          />
        </label>

        <div className="event-modal-actions">
          <button
            className="button"
            type="button"
            onClick={onSaveDisplayName}
            disabled={saveBusy}
          >
            {t('save')}
          </button>
        </div>

        <section className="student-settings-view-mode">
          <h3>{t('pipelineViewMode')}</h3>
          <div className="student-settings-view-mode-toggle">
            <button
              type="button"
              className={`button tiny ${!simplifiedView ? 'active' : 'secondary'}`}
              onClick={() => onSimplifiedViewChange(false)}
            >
              {t('pipelineViewModeAdvanced')}
            </button>
            <button
              type="button"
              className={`button tiny ${simplifiedView ? 'active' : 'secondary'}`}
              onClick={() => onSimplifiedViewChange(true)}
            >
              {t('pipelineViewModeSimple')}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
