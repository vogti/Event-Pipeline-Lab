import type { I18nKey } from '../../i18n';
import { CloseIcon } from '../../app/shared-icons';
import { ModalPortal } from './ModalPortal';

interface AboutEplModalProps {
  t: (key: I18nKey) => string;
  open: boolean;
  deploymentGitHash: string;
  deploymentCommitUrl: string;
  buildTimeLabel: string;
  deploymentDirty: boolean;
  onClose: () => void;
}

export function AboutEplModal({
  t,
  open,
  deploymentGitHash,
  deploymentCommitUrl,
  buildTimeLabel,
  deploymentDirty,
  onClose
}: AboutEplModalProps) {
  if (!open) {
    return null;
  }

  return (
    <ModalPortal>
      <div className="event-modal-backdrop" onClick={onClose}>
        <div className="event-modal about-epl-modal" onClick={(event) => event.stopPropagation()}>
          <div className="panel-header">
            <h2>{t('aboutEpl')}</h2>
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

          <p>{t('aboutEplPurpose')}</p>
          <p>{t('aboutEplProbelektion')}</p>
          <p>{t('aboutEplAuthor')}</p>

          <div className="about-epl-hash-row">
            <span className="about-epl-hash-label">{t('aboutEplDeploymentHash')}</span>
            {deploymentCommitUrl.trim().length > 0 && deploymentGitHash.trim().length > 0 && deploymentGitHash !== 'unknown' ? (
              <a
                className="chip mono about-epl-hash-link"
                href={deploymentCommitUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {deploymentGitHash}
              </a>
            ) : (
              <span className="chip mono">{deploymentGitHash.trim() || 'unknown'}</span>
            )}
          </div>

          <div className="about-epl-hash-row">
            <span className="about-epl-hash-label">{t('aboutEplBuildTime')}</span>
            <span className="chip mono">{buildTimeLabel}</span>
          </div>

          <div className="about-epl-hash-row">
            <span className="about-epl-hash-label">{t('aboutEplDirty')}</span>
            <span className={`chip ${deploymentDirty ? 'warn' : 'ok'}`}>
              {deploymentDirty ? t('aboutEplDirtyYes') : t('aboutEplDirtyNo')}
            </span>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
