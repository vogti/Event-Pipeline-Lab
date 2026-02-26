import type { FormEvent } from 'react';
import type { I18nKey, Language } from '../../i18n';

interface StudentOnboardingSectionProps {
  t: (key: I18nKey) => string;
  language: Language;
  displayNameDraft: string;
  busy: boolean;
  onDisplayNameChange: (value: string) => void;
  onSetLanguage: (language: Language) => void;
  onSubmit: () => void;
}

export function StudentOnboardingSection({
  t,
  language,
  displayNameDraft,
  busy,
  onDisplayNameChange,
  onSetLanguage,
  onSubmit
}: StudentOnboardingSectionProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <section className="panel panel-animate student-onboarding-panel">
      <h2>{t('onboardingTitle')}</h2>
      <p className="muted">{t('onboardingSubtitle')}</p>

      <form className="form-grid student-onboarding-form" onSubmit={submit}>
        <label>
          <span>{t('displayName')}</span>
          <input
            className="input"
            value={displayNameDraft}
            onChange={(event) => onDisplayNameChange(event.target.value)}
            autoFocus
          />
        </label>

        <div className="student-onboarding-language">
          <span>{t('language')}</span>
          <div className="user-menu-actions">
            <button
              className={`button tiny ${language === 'de' ? 'active' : 'secondary'}`}
              type="button"
              onClick={() => onSetLanguage('de')}
            >
              DE
            </button>
            <button
              className={`button tiny ${language === 'en' ? 'active' : 'secondary'}`}
              type="button"
              onClick={() => onSetLanguage('en')}
            >
              EN
            </button>
          </div>
        </div>

        <button className="button" type="submit" disabled={busy}>
          {t('onboardingContinue')}
        </button>
      </form>
    </section>
  );
}
