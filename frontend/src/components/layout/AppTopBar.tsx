import type { RefObject } from 'react';
import type { I18nKey, Language } from '../../i18n';
import type { WsConnectionState } from '../../app/shared-types';

interface AppTopBarProps {
  t: (key: I18nKey) => string;
  hasSession: boolean;
  userMenuRef: RefObject<HTMLDivElement>;
  userMenuOpen: boolean;
  userMenuLabel: string;
  wsConnection: WsConnectionState;
  wsLabel: string;
  roleLabel: string | null;
  language: Language;
  showPipelineViewModeToggle?: boolean;
  pipelineSimplifiedView?: boolean;
  logoutBusy: boolean;
  onToggleUserMenu: () => void;
  onSetLanguage: (language: Language) => void;
  onPipelineSimplifiedViewChange?: (next: boolean) => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onLogout: () => void;
}

export function AppTopBar({
  t,
  hasSession,
  userMenuRef,
  userMenuOpen,
  userMenuLabel,
  wsConnection,
  wsLabel,
  roleLabel,
  language,
  showPipelineViewModeToggle = false,
  pipelineSimplifiedView = false,
  logoutBusy,
  onToggleUserMenu,
  onSetLanguage,
  onPipelineSimplifiedViewChange,
  onOpenSettings,
  onOpenAbout,
  onLogout
}: AppTopBarProps) {
  return (
    <header className="topbar">
      <div>
        <h1>{t('appTitle')}</h1>
        <p>{t('appSubtitle')}</p>
      </div>

      <div className="topbar-controls">
        {hasSession ? (
          <div className="user-menu" ref={userMenuRef}>
            <button
              className="button secondary user-menu-trigger"
              type="button"
              onClick={onToggleUserMenu}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
            >
              <span className="user-menu-name">{userMenuLabel}</span>
              <span className="user-menu-caret" aria-hidden="true">▾</span>
            </button>

            {userMenuOpen ? (
              <div className="user-menu-panel" role="menu">
                <div className="user-menu-status-row">
                  <span className={`status-pill ${wsConnection}`}>{wsLabel}</span>
                  {roleLabel ? <span className="status-pill role">{roleLabel}</span> : null}
                </div>

                <div className="user-menu-section">
                  <div className="user-menu-label">{t('language')}</div>
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

                {showPipelineViewModeToggle && onPipelineSimplifiedViewChange ? (
                  <div className="user-menu-section">
                    <div className="user-menu-label">{t('pipelineViewMode')}</div>
                    <div className="user-menu-actions">
                      <button
                        className={`button tiny ${!pipelineSimplifiedView ? 'active' : 'secondary'}`}
                        type="button"
                        onClick={() => onPipelineSimplifiedViewChange(false)}
                      >
                        {t('pipelineViewModeAdvanced')}
                      </button>
                      <button
                        className={`button tiny ${pipelineSimplifiedView ? 'active' : 'secondary'}`}
                        type="button"
                        onClick={() => onPipelineSimplifiedViewChange(true)}
                      >
                        {t('pipelineViewModeSimple')}
                      </button>
                    </div>
                  </div>
                ) : null}

                <button className="button secondary user-menu-link" type="button" onClick={onOpenSettings}>
                  {t('settings')}
                </button>

                <button className="button secondary user-menu-link" type="button" onClick={onOpenAbout}>
                  {t('aboutEpl')}
                </button>

                <button
                  className="button danger user-menu-link"
                  type="button"
                  onClick={onLogout}
                  disabled={logoutBusy}
                >
                  {t('logout')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
