import type { I18nKey } from '../../i18n';
import type { AdminPage } from '../../app/shared-types';

interface AdminPageNavProps {
  t: (key: I18nKey) => string;
  adminPage: AdminPage;
  onChangePage: (page: AdminPage) => void;
}

export function AdminPageNav({ t, adminPage, onChangePage }: AdminPageNavProps) {
  return (
    <nav className="panel panel-animate admin-page-nav">
      <button
        className={`button tiny ${adminPage === 'dashboard' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('dashboard')}
      >
        {t('dashboard')}
      </button>
      <button
        className={`button tiny ${adminPage === 'devices' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('devices')}
      >
        {t('devices')}
      </button>
      <button
        className={`button tiny ${adminPage === 'virtualDevices' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('virtualDevices')}
      >
        {t('virtualDevices')}
      </button>
      <button
        className={`button tiny ${adminPage === 'streamSources' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('streamSources')}
      >
        {t('streamSources')}
      </button>
      <button
        className={`button tiny ${adminPage === 'tasks' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('tasks')}
      >
        {t('tasks')}
      </button>
      <button
        className={`button tiny ${adminPage === 'groups' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('groups')}
      >
        {t('groups')}
      </button>
      <button
        className={`button tiny ${adminPage === 'scenarios' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('scenarios')}
      >
        {t('scenarioPage')}
      </button>
      <button
        className={`button tiny ${adminPage === 'feed' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('feed')}
      >
        {t('liveFeed')}
      </button>
      <button
        className={`button tiny ${adminPage === 'pipeline' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('pipeline')}
      >
        {t('pipelineBuilder')}
      </button>
      <button
        className={`button tiny ${adminPage === 'systemStatus' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('systemStatus')}
      >
        {t('systemStatus')}
      </button>
      <button
        className={`button tiny ${adminPage === 'settings' ? 'active' : 'secondary'}`}
        type="button"
        onClick={() => onChangePage('settings')}
      >
        {t('settings')}
      </button>
    </nav>
  );
}
