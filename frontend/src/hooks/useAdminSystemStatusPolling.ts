import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { api } from '../api';
import { sameAdminSystemStatus } from '../app/shared';
import type { AdminPage } from '../app/shared-types';
import type { AdminSystemStatus, AppRole } from '../types';

interface UseAdminSystemStatusPollingParams {
  token: string | null;
  role: AppRole | null;
  adminPage: AdminPage;
  reportBackgroundError: (context: string, error: unknown) => void;
  setAdminSystemStatus: Dispatch<SetStateAction<AdminSystemStatus | null>>;
}

export function useAdminSystemStatusPolling({
  token,
  role,
  adminPage,
  reportBackgroundError,
  setAdminSystemStatus
}: UseAdminSystemStatusPollingParams): void {
  useEffect(() => {
    const onStatusPage = adminPage === 'systemStatus' || adminPage === 'dashboard';
    if (!token || role !== 'ADMIN' || !onStatusPage) {
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    const loadStatus = async () => {
      try {
        const latest = await api.adminSystemStatus(token);
        if (cancelled) {
          return;
        }
        setAdminSystemStatus((previous) =>
          sameAdminSystemStatus(previous, latest) ? previous : latest
        );
      } catch (error) {
        if (!cancelled) {
          reportBackgroundError('adminSystemStatus', error);
        }
      }
    };

    loadStatus().catch((error) => reportBackgroundError('adminSystemStatus', error));
    intervalId = window.setInterval(() => {
      loadStatus().catch((error) => reportBackgroundError('adminSystemStatus', error));
    }, 5000);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [adminPage, reportBackgroundError, role, setAdminSystemStatus, token]);
}
