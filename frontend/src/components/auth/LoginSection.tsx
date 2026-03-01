import type { FormEvent } from 'react';
import type { I18nKey } from '../../i18n';

interface LoginSectionProps {
  t: (key: I18nKey) => string;
  username: string;
  pin: string;
  busy: boolean;
  onUsernameChange: (value: string) => void;
  onPinChange: (value: string) => void;
  onSubmit: () => void;
}

export function LoginSection({
  t,
  username,
  pin,
  busy,
  onUsernameChange,
  onPinChange,
  onSubmit
}: LoginSectionProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <section className="panel login-panel panel-animate">
      <div className="login-panel-header">
        <h2>{t('loginTitle')}</h2>
        <p className="login-panel-subtitle">{t('appSubtitle')}</p>
      </div>
      <form onSubmit={submit} className="form-grid login-form">
        <label>
          <span>{t('username')}</span>
          <input
            className="input"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            required
          />
        </label>

        <label>
          <span>{t('pin')}</span>
          <input
            className="input"
            type="password"
            value={pin}
            onChange={(event) => onPinChange(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="current-password"
            spellCheck={false}
            required
          />
        </label>

        <button className="button" type="submit" disabled={busy}>
          {t('login')}
        </button>
      </form>
      <p className="muted login-hint">{t('loginHint')}</p>
    </section>
  );
}
