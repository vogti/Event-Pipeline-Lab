import type { I18nKey } from '../../i18n';

interface MainStateBannersProps {
  t: (key: I18nKey) => string;
  errorMessage: string | null;
  infoMessage: string | null;
  booting: boolean;
}

export function MainStateBanners({
  t,
  errorMessage,
  infoMessage,
  booting
}: MainStateBannersProps) {
  return (
    <>
      {errorMessage ? (
        <div className="alert error">
          {t('errorPrefix')}: {errorMessage}
        </div>
      ) : null}

      {infoMessage ? <div className="alert info">{infoMessage}</div> : null}

      {booting ? (
        <section className="panel loading">{t('loading')}</section>
      ) : null}
    </>
  );
}
