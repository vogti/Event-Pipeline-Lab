import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from './api';
import {
  type AppSettings,
  type AuthMe,
  type CanonicalEvent,
  type DeviceCommandType,
  type DeviceStatus,
  type EventCategory,
  type GroupConfig,
  type GroupOverview,
  type LanguageMode,
  type PresenceUser,
  type TimestampValue,
  type TaskCapabilities,
  type TaskDefinitionPayload,
  type TaskInfo,
  type WsEnvelope
} from './types';
import { type I18nKey, type Language, resolveLanguageFromMode, taskDescription, taskTitle, tr } from './i18n';

const TOKEN_STORAGE_KEY = 'epl.sessionToken';
const LANGUAGE_STORAGE_KEY = 'epl.languageOverride';
const MAX_FEED_EVENTS = 200;

interface StudentViewData {
  activeTask: TaskInfo;
  capabilities: TaskCapabilities;
  groupConfig: GroupConfig;
  groupPresence: PresenceUser[];
  feed: CanonicalEvent[];
  settings: AppSettings;
}

interface AdminViewData {
  tasks: TaskInfo[];
  devices: DeviceStatus[];
  groups: GroupOverview[];
  events: CanonicalEvent[];
  settings: AppSettings;
}

type WsConnectionState = 'connecting' | 'connected' | 'disconnected';

const CATEGORY_OPTIONS: Array<EventCategory | 'ALL'> = [
  'ALL',
  'BUTTON',
  'COUNTER',
  'SENSOR',
  'STATUS',
  'INTERNAL',
  'COMMAND',
  'ACK'
];

function timestampToEpochMillis(value: TimestampValue): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.abs(value) < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Math.abs(numeric) < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function compareByNewestIngestTs(a: CanonicalEvent, b: CanonicalEvent): number {
  const aEpoch = timestampToEpochMillis(a.ingestTs) ?? Number.MIN_SAFE_INTEGER;
  const bEpoch = timestampToEpochMillis(b.ingestTs) ?? Number.MIN_SAFE_INTEGER;
  if (aEpoch === bEpoch) {
    return b.id.localeCompare(a.id);
  }
  return bEpoch - aEpoch;
}

function prependBounded(items: CanonicalEvent[], item: CanonicalEvent, maxSize: number): CanonicalEvent[] {
  const next = [item, ...items].sort(compareByNewestIngestTs);
  if (next.length <= maxSize) {
    return next;
  }
  return next.slice(0, maxSize);
}

function clampFeed(items: CanonicalEvent[]): CanonicalEvent[] {
  const sorted = [...items].sort(compareByNewestIngestTs);
  if (sorted.length <= MAX_FEED_EVENTS) {
    return sorted;
  }
  return sorted.slice(0, MAX_FEED_EVENTS);
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function getStoredLanguageOverride(): Language | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (value === 'de' || value === 'en') {
    return value;
  }
  return null;
}

function setStoredLanguageOverride(value: Language | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (value === null) {
    window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
  } else {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message} (${error.status})`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

function formatTimestamp(value: TimestampValue, language: Language, use24HourTime: boolean): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  const epochMillis = timestampToEpochMillis(value);
  if (epochMillis === null) {
    return typeof value === 'string' ? value : String(value);
  }

  const parsed = new Date(epochMillis);
  const locale = language === 'de' ? 'de-CH' : 'en-US';
  return parsed.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: !use24HourTime
  });
}

function safeConfigMap(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function extractTaskInfo(payload: unknown): TaskInfo | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Partial<TaskInfo>;
  if (
    typeof data.id !== 'string' ||
    typeof data.titleDe !== 'string' ||
    typeof data.titleEn !== 'string' ||
    typeof data.descriptionDe !== 'string' ||
    typeof data.descriptionEn !== 'string'
  ) {
    return null;
  }

  return {
    id: data.id,
    titleDe: data.titleDe,
    titleEn: data.titleEn,
    descriptionDe: data.descriptionDe,
    descriptionEn: data.descriptionEn,
    active: typeof data.active === 'boolean' ? data.active : true
  };
}

function statusLabel(online: boolean, language: Language): string {
  if (online) {
    return language === 'de' ? 'Online' : 'Online';
  }
  return language === 'de' ? 'Offline' : 'Offline';
}

function sanitizeConfigForCapabilities(
  config: Record<string, unknown>,
  capabilities: TaskCapabilities
): Record<string, unknown> {
  if (capabilities.allowedConfigOptions.includes('*')) {
    return { ...config };
  }

  const allowed = new Set(capabilities.allowedConfigOptions);
  const next: Record<string, unknown> = {};
  Object.entries(config).forEach(([key, value]) => {
    if (allowed.has(key)) {
      next[key] = value;
    }
  });
  return next;
}

function feedMatchesTopic(event: CanonicalEvent, topicFilter: string): boolean {
  const filter = topicFilter.trim().toLowerCase();
  if (!filter) {
    return true;
  }

  return (
    event.topic.toLowerCase().includes(filter) ||
    event.eventType.toLowerCase().includes(filter) ||
    event.deviceId.toLowerCase().includes(filter)
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [session, setSession] = useState<AuthMe | null>(null);
  const [booting, setBooting] = useState(true);

  const [loginUsername, setLoginUsername] = useState('');
  const [loginPin, setLoginPin] = useState('');

  const [studentData, setStudentData] = useState<StudentViewData | null>(null);
  const [studentConfigDraft, setStudentConfigDraft] = useState<Record<string, unknown>>({});
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [studentTopicFilter, setStudentTopicFilter] = useState('');
  const [studentShowInternal, setStudentShowInternal] = useState(false);
  const [studentFeedPaused, setStudentFeedPaused] = useState(false);

  const [adminData, setAdminData] = useState<AdminViewData | null>(null);
  const [adminTopicFilter, setAdminTopicFilter] = useState('');
  const [adminCategoryFilter, setAdminCategoryFilter] = useState<EventCategory | 'ALL'>('ALL');
  const [adminDeviceFilter, setAdminDeviceFilter] = useState('');
  const [adminIncludeInternal, setAdminIncludeInternal] = useState(false);
  const [adminFeedPaused, setAdminFeedPaused] = useState(false);
  const [adminSettingsDraftMode, setAdminSettingsDraftMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [adminSettingsDraftTimeFormat24h, setAdminSettingsDraftTimeFormat24h] = useState(true);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [wsConnection, setWsConnection] = useState<WsConnectionState>('disconnected');

  const [defaultLanguageMode, setDefaultLanguageMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [timeFormat24h, setTimeFormat24h] = useState(true);
  const [languageOverride, setLanguageOverride] = useState<Language | null>(() => getStoredLanguageOverride());

  const studentPauseRef = useRef(studentFeedPaused);
  const adminPauseRef = useRef(adminFeedPaused);

  useEffect(() => {
    studentPauseRef.current = studentFeedPaused;
  }, [studentFeedPaused]);

  useEffect(() => {
    adminPauseRef.current = adminFeedPaused;
  }, [adminFeedPaused]);

  const language = useMemo<Language>(() => {
    if (languageOverride) {
      return languageOverride;
    }
    const browserLanguages =
      typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language];
    return resolveLanguageFromMode(defaultLanguageMode, browserLanguages);
  }, [defaultLanguageMode, languageOverride]);

  const t = useCallback(
    (key: I18nKey): string => {
      return tr(language, key);
    },
    [language]
  );

  const clearRoleState = useCallback(() => {
    setStudentData(null);
    setStudentConfigDraft({});
    setDisplayNameDraft('');
    setStudentTopicFilter('');
    setStudentShowInternal(false);
    setStudentFeedPaused(false);

    setAdminData(null);
    setAdminTopicFilter('');
    setAdminCategoryFilter('ALL');
    setAdminDeviceFilter('');
    setAdminIncludeInternal(false);
    setAdminFeedPaused(false);
    setAdminSettingsDraftMode('BROWSER_EN_FALLBACK');
    setAdminSettingsDraftTimeFormat24h(true);
  }, []);

  const clearAuth = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    setToken(null);
    setSession(null);
    setWsConnection('disconnected');
    clearRoleState();
  }, [clearRoleState]);

  const refreshAdminGroups = useCallback(async (activeToken: string) => {
    const groups = await api.adminGroups(activeToken);
    setAdminData((previous) => {
      if (!previous) {
        return previous;
      }
      return { ...previous, groups };
    });
  }, []);

  const refreshAdminTasks = useCallback(async (activeToken: string) => {
    const tasks = await api.adminTasks(activeToken);
    setAdminData((previous) => {
      if (!previous) {
        return previous;
      }
      return { ...previous, tasks };
    });
  }, []);

  const loadDashboards = useCallback(async (auth: AuthMe, activeToken: string) => {
    if (auth.role === 'STUDENT') {
      const bootstrap = await api.studentBootstrap(activeToken);
      setStudentData({
        activeTask: bootstrap.activeTask,
        capabilities: bootstrap.capabilities,
        groupConfig: bootstrap.groupConfig,
        groupPresence: bootstrap.groupPresence,
        feed: clampFeed(bootstrap.recentFeed),
        settings: bootstrap.settings
      });
      setStudentConfigDraft(safeConfigMap(bootstrap.groupConfig.config));
      setDisplayNameDraft(bootstrap.me.displayName);
      setDefaultLanguageMode(bootstrap.settings.defaultLanguageMode);
      setTimeFormat24h(bootstrap.settings.timeFormat24h);
      return;
    }

    const [tasks, devices, groups, settings, events] = await Promise.all([
      api.adminTasks(activeToken),
      api.adminDevices(activeToken),
      api.adminGroups(activeToken),
      api.adminSettings(activeToken),
      api.eventsFeed(activeToken, { limit: MAX_FEED_EVENTS, includeInternal: true })
    ]);

    setAdminData({
      tasks,
      devices,
      groups,
      settings,
      events: clampFeed(events)
    });
    setAdminSettingsDraftMode(settings.defaultLanguageMode);
    setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
    setDefaultLanguageMode(settings.defaultLanguageMode);
    setTimeFormat24h(settings.timeFormat24h);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrapFromToken(): Promise<void> {
      if (!token) {
        setSession(null);
        clearRoleState();
        setBooting(false);
        return;
      }

      setBooting(true);
      setErrorMessage(null);

      try {
        const me = await api.me(token);
        if (cancelled) {
          return;
        }

        setSession(me);
        await loadDashboards(me, token);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setErrorMessage(toErrorMessage(error));
        clearAuth();
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    }

    bootstrapFromToken().catch((error) => {
      if (!cancelled) {
        setErrorMessage(toErrorMessage(error));
        clearAuth();
        setBooting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [clearAuth, clearRoleState, loadDashboards, token]);

  useEffect(() => {
    if (!studentData || studentData.capabilities.showInternalEventsToggle) {
      return;
    }
    setStudentShowInternal(false);
  }, [studentData]);

  useEffect(() => {
    if (!session || !token) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let groupRefreshTimer: number | null = null;
    let closed = false;

    const rolePath = session.role === 'ADMIN' ? '/ws/admin' : '/ws/student';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const scheduleGroupRefresh = () => {
      if (groupRefreshTimer !== null) {
        return;
      }
      groupRefreshTimer = window.setTimeout(() => {
        groupRefreshTimer = null;
        refreshAdminGroups(token).catch((error) => setErrorMessage(toErrorMessage(error)));
      }, 350);
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer !== null) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1500);
    };

    const handleEnvelope = (envelope: WsEnvelope<unknown>) => {
      if (session.role === 'STUDENT') {
        if (envelope.type === 'event.feed.append') {
          if (studentPauseRef.current) {
            return;
          }
          const eventPayload = envelope.payload as CanonicalEvent;
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              feed: prependBounded(previous.feed, eventPayload, MAX_FEED_EVENTS)
            };
          });
          return;
        }

        if (envelope.type === 'group.presence.updated') {
          const presence = Array.isArray(envelope.payload)
            ? (envelope.payload as PresenceUser[])
            : [];
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              groupPresence: presence
            };
          });
          return;
        }

        if (envelope.type === 'group.config.updated') {
          const nextConfig = envelope.payload as GroupConfig;
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              groupConfig: nextConfig
            };
          });
          setStudentConfigDraft(safeConfigMap(nextConfig.config));
          return;
        }

        if (envelope.type === 'capabilities.updated') {
          const nextCapabilities = envelope.payload as TaskCapabilities;
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              capabilities: nextCapabilities
            };
          });
          return;
        }

        if (envelope.type === 'task.updated') {
          if (!envelope.payload || typeof envelope.payload !== 'object') {
            return;
          }
          const taskLike = envelope.payload as TaskDefinitionPayload | TaskInfo;
          const task = extractTaskInfo(taskLike);
          if (!task) {
            return;
          }
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              activeTask: task,
              capabilities:
                (taskLike as TaskDefinitionPayload).studentCapabilities ?? previous.capabilities
            };
          });
          setInfoMessage(t('taskUpdated'));
          return;
        }

        if (envelope.type === 'error.notification') {
          setErrorMessage(String(envelope.payload));
          return;
        }

        if (envelope.type === 'settings.updated') {
          const settings = envelope.payload as AppSettings;
          setStudentData((previous) => {
            if (!previous) {
              return previous;
            }
            return {
              ...previous,
              settings
            };
          });
          setDefaultLanguageMode(settings.defaultLanguageMode);
          setTimeFormat24h(settings.timeFormat24h);
        }
        return;
      }

      if (envelope.type === 'event.feed.append') {
        if (adminPauseRef.current) {
          return;
        }
        const eventPayload = envelope.payload as CanonicalEvent;
        setAdminData((previous) => {
          if (!previous) {
            return previous;
          }
          return {
            ...previous,
            events: prependBounded(previous.events, eventPayload, MAX_FEED_EVENTS)
          };
        });
        return;
      }

      if (envelope.type === 'device.status.updated') {
        const nextDevice = envelope.payload as DeviceStatus;
        setAdminData((previous) => {
          if (!previous) {
            return previous;
          }

          const index = previous.devices.findIndex((device) => device.deviceId === nextDevice.deviceId);
          if (index < 0) {
            return {
              ...previous,
              devices: [...previous.devices, nextDevice].sort((a, b) =>
                a.deviceId.localeCompare(b.deviceId)
              )
            };
          }

          const nextDevices = [...previous.devices];
          nextDevices[index] = nextDevice;
          return {
            ...previous,
            devices: nextDevices
          };
        });
        return;
      }

      if (envelope.type === 'admin.groups.updated') {
        scheduleGroupRefresh();
        return;
      }

      if (envelope.type === 'task.updated') {
        refreshAdminTasks(token).catch((error) => setErrorMessage(toErrorMessage(error)));
        return;
      }

      if (envelope.type === 'settings.updated') {
        const settings = envelope.payload as AppSettings;
        setAdminData((previous) => {
          if (!previous) {
            return previous;
          }
          return {
            ...previous,
            settings
          };
        });
        setAdminSettingsDraftMode(settings.defaultLanguageMode);
        setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
        setDefaultLanguageMode(settings.defaultLanguageMode);
        setTimeFormat24h(settings.timeFormat24h);
        return;
      }

      if (envelope.type === 'error.notification') {
        setErrorMessage(String(envelope.payload));
      }
    };

    const connect = () => {
      if (closed) {
        return;
      }

      setWsConnection('connecting');
      socket = new WebSocket(
        `${protocol}//${window.location.host}${rolePath}?token=${encodeURIComponent(token)}`
      );

      socket.onopen = () => {
        if (!closed) {
          setWsConnection('connected');
        }
        if (reconnectTimer !== null) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };

      socket.onmessage = (event) => {
        try {
          const envelope = JSON.parse(event.data) as WsEnvelope<unknown>;
          handleEnvelope(envelope);
        } catch (error) {
          setErrorMessage(toErrorMessage(error));
        }
      };

      socket.onclose = () => {
        if (closed) {
          return;
        }
        setWsConnection('disconnected');
        scheduleReconnect();
      };

      socket.onerror = () => {
        if (!closed) {
          setWsConnection('disconnected');
          scheduleReconnect();
        }
      };
    };

    connect();

    return () => {
      closed = true;
      setWsConnection('disconnected');

      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (groupRefreshTimer !== null) {
        window.clearTimeout(groupRefreshTimer);
      }

      if (socket) {
        socket.close();
      }
    };
  }, [refreshAdminGroups, refreshAdminTasks, session, t, token]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyKey('login');
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const me = await api.login(loginUsername.trim(), loginPin.trim());
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, me.sessionToken);
      }
      setToken(me.sessionToken);
      setLoginPin('');
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const handleLogout = async () => {
    const activeToken = token;
    setBusyKey('logout');

    try {
      if (activeToken) {
        await api.logout(activeToken);
      }
    } catch {
      // ignore logout transport errors to keep local logout reliable
    } finally {
      setBusyKey(null);
      clearAuth();
      setBooting(false);
    }
  };

  const setManualLanguage = (nextLanguage: Language) => {
    setLanguageOverride(nextLanguage);
    setStoredLanguageOverride(nextLanguage);
  };

  const resetLanguageToDefaultMode = () => {
    setLanguageOverride(null);
    setStoredLanguageOverride(null);
  };

  const saveDisplayName = async () => {
    if (!token || !session || session.role !== 'STUDENT') {
      return;
    }

    setBusyKey('display-name');
    setErrorMessage(null);

    try {
      const updated = await api.updateDisplayName(token, displayNameDraft.trim());
      setSession(updated);
      setInfoMessage(t('displayNameSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveStudentConfig = async () => {
    if (!token || !studentData) {
      return;
    }

    setBusyKey('student-config');
    setErrorMessage(null);

    try {
      const sanitized = sanitizeConfigForCapabilities(studentConfigDraft, studentData.capabilities);
      const updated = await api.updateStudentConfig(token, sanitized);
      setStudentData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          groupConfig: updated
        };
      });
      setStudentConfigDraft(safeConfigMap(updated.config));
      setInfoMessage(t('configSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const sendStudentCommand = async (command: DeviceCommandType, on?: boolean) => {
    if (!token || !session || session.role !== 'STUDENT' || !session.groupKey) {
      return;
    }

    setBusyKey(`student-command-${command}-${String(on)}`);
    setErrorMessage(null);

    try {
      await api.sendStudentCommand(token, session.groupKey, command, on);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const activateTask = async (taskId: string) => {
    if (!token) {
      return;
    }

    setBusyKey(`activate-${taskId}`);
    setErrorMessage(null);

    try {
      const task = await api.activateTask(token, taskId);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }

        const nextTasks = previous.tasks.map((entry) => ({
          ...entry,
          active: entry.id === task.id
        }));

        return {
          ...previous,
          tasks: nextTasks
        };
      });
      setInfoMessage(t('taskUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const saveAdminSettings = async () => {
    if (!token) {
      return;
    }

    setBusyKey('admin-settings');
    setErrorMessage(null);

    try {
      const updated = await api.updateAdminSettings(
        token,
        adminSettingsDraftMode,
        adminSettingsDraftTimeFormat24h
      );
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          settings: updated
        };
      });
      setDefaultLanguageMode(updated.defaultLanguageMode);
      setTimeFormat24h(updated.timeFormat24h);
      setAdminSettingsDraftTimeFormat24h(updated.timeFormat24h);
      setInfoMessage(t('settingsUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const sendAdminDeviceCommand = async (
    deviceId: string,
    command: DeviceCommandType,
    on?: boolean
  ) => {
    if (!token) {
      return;
    }

    setBusyKey(`admin-command-${deviceId}-${command}-${String(on)}`);
    setErrorMessage(null);

    try {
      await api.adminDeviceCommand(token, deviceId, command, on);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const refreshAdminData = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }

    setBusyKey('admin-refresh');
    setErrorMessage(null);

    try {
      const [tasks, devices, groups, events, settings] = await Promise.all([
        api.adminTasks(token),
        api.adminDevices(token),
        api.adminGroups(token),
        api.eventsFeed(token, { limit: MAX_FEED_EVENTS, includeInternal: true }),
        api.adminSettings(token)
      ]);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          tasks,
          devices,
          groups,
          events: clampFeed(events),
          settings
        };
      });
      setAdminSettingsDraftMode(settings.defaultLanguageMode);
      setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
      setDefaultLanguageMode(settings.defaultLanguageMode);
      setTimeFormat24h(settings.timeFormat24h);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const studentVisibleFeed = useMemo(() => {
    if (!studentData) {
      return [];
    }

    return studentData.feed.filter((event) => {
      if (!studentShowInternal && event.isInternal) {
        return false;
      }
      return feedMatchesTopic(event, studentTopicFilter);
    });
  }, [studentData, studentShowInternal, studentTopicFilter]);

  const adminVisibleFeed = useMemo(() => {
    if (!adminData) {
      return [];
    }

    return adminData.events.filter((event) => {
      if (!adminIncludeInternal && event.isInternal) {
        return false;
      }

      if (adminCategoryFilter !== 'ALL' && event.category !== adminCategoryFilter) {
        return false;
      }

      if (adminDeviceFilter.trim().length > 0 && event.deviceId !== adminDeviceFilter.trim()) {
        return false;
      }

      return feedMatchesTopic(event, adminTopicFilter);
    });
  }, [adminCategoryFilter, adminData, adminDeviceFilter, adminIncludeInternal, adminTopicFilter]);

  const wsLabel = useMemo(() => {
    if (wsConnection === 'connected') {
      return t('wsConnected');
    }
    if (wsConnection === 'connecting') {
      return t('wsConnecting');
    }
    return t('wsDisconnected');
  }, [t, wsConnection]);

  const roleLabel = useMemo(() => {
    if (!session) {
      return null;
    }
    return session.role === 'ADMIN' ? t('roleAdmin') : t('roleStudent');
  }, [session, t]);

  const formatTs = useCallback(
    (value: TimestampValue): string => {
      return formatTimestamp(value, language, timeFormat24h);
    },
    [language, timeFormat24h]
  );

  const renderConfigInput = (
    option: string,
    value: unknown,
    setValue: (next: unknown) => void
  ) => {
    if (option === 'displayMode') {
      const selected = typeof value === 'string' ? value : 'compact';
      return (
        <select
          className="input"
          value={selected}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="compact">compact</option>
          <option value="detailed">detailed</option>
        </select>
      );
    }

    if (option === 'sensorFocus') {
      const selected = typeof value === 'string' ? value : 'all';
      return (
        <select
          className="input"
          value={selected}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="all">all</option>
          <option value="ldr">ldr</option>
          <option value="dht22">dht22</option>
          <option value="buttons">buttons</option>
        </select>
      );
    }

    if (option === 'commandPanel') {
      return (
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => setValue(event.target.checked)}
          />
          <span>enabled</span>
        </label>
      );
    }

    const textValue =
      typeof value === 'string'
        ? value
        : value === undefined || value === null
          ? ''
          : JSON.stringify(value);

    return (
      <input
        className="input"
        value={textValue}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>{t('appTitle')}</h1>
          <p>{t('appSubtitle')}</p>
        </div>

        <div className="topbar-controls">
          <div className={`status-pill ${wsConnection}`}>{wsLabel}</div>
          {roleLabel ? <div className="status-pill role">{roleLabel}</div> : null}

          <div className="language-controls">
            <span>{t('language')}</span>
            <button
              className={`button tiny ${language === 'de' ? 'active' : 'secondary'}`}
              type="button"
              onClick={() => setManualLanguage('de')}
            >
              DE
            </button>
            <button
              className={`button tiny ${language === 'en' ? 'active' : 'secondary'}`}
              type="button"
              onClick={() => setManualLanguage('en')}
            >
              EN
            </button>
            <button className="button tiny ghost" type="button" onClick={resetLanguageToDefaultMode}>
              {t('useDefaultLanguage')}
            </button>
          </div>

          {session ? (
            <button
              className="button danger"
              type="button"
              onClick={handleLogout}
              disabled={busyKey === 'logout'}
            >
              {t('logout')}
            </button>
          ) : null}
        </div>
      </header>

      <main className="content">
        {errorMessage ? (
          <div className="alert error">
            {t('errorPrefix')}: {errorMessage}
          </div>
        ) : null}

        {infoMessage ? <div className="alert info">{infoMessage}</div> : null}

        {booting ? (
          <section className="panel loading">{t('loading')}</section>
        ) : null}

        {!booting && !session ? (
          <section className="panel login-panel">
            <h2>{t('loginTitle')}</h2>
            <form onSubmit={handleLogin} className="form-grid">
              <label>
                <span>{t('username')}</span>
                <input
                  className="input"
                  value={loginUsername}
                  onChange={(event) => setLoginUsername(event.target.value)}
                  required
                />
              </label>

              <label>
                <span>{t('pin')}</span>
                <input
                  className="input"
                  type="password"
                  value={loginPin}
                  onChange={(event) => setLoginPin(event.target.value)}
                  required
                />
              </label>

              <button className="button" type="submit" disabled={busyKey === 'login'}>
                {t('login')}
              </button>
            </form>
            <p className="muted">{t('loginHint')}</p>
          </section>
        ) : null}

        {!booting && session?.role === 'STUDENT' && studentData ? (
          <div className="dashboard-grid">
            <section className="panel hero panel-animate">
              <h2>{t('currentTask')}</h2>
              <h3>{taskTitle(studentData.activeTask, language)}</h3>
              <p>{taskDescription(studentData.activeTask, language)}</p>

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
                    onChange={(event) => setDisplayNameDraft(event.target.value)}
                  />
                </label>

                <button
                  className="button"
                  type="button"
                  onClick={saveDisplayName}
                  disabled={busyKey === 'display-name'}
                >
                  {t('save')}
                </button>
              </div>
            </section>

            <section className="panel panel-animate">
              <h2>{t('groupConfig')}</h2>
              <div className="config-grid">
                {studentData.capabilities.allowedConfigOptions.map((option) => (
                  <label key={option}>
                    <span>{option}</span>
                    {renderConfigInput(option, studentConfigDraft[option], (next) => {
                      setStudentConfigDraft((previous) => ({
                        ...previous,
                        [option]: next
                      }));
                    })}
                  </label>
                ))}
              </div>

              <div className="meta-row">
                <span>
                  {t('revision')}: {studentData.groupConfig.revision}
                </span>
                <span>
                  {t('updatedBy')}: {studentData.groupConfig.updatedBy}
                </span>
                <span>
                  {t('lastSeen')}: {formatTs(studentData.groupConfig.updatedAt)}
                </span>
              </div>

              <button
                className="button"
                type="button"
                onClick={saveStudentConfig}
                disabled={busyKey === 'student-config'}
              >
                {t('save')}
              </button>
            </section>

            <section className="panel panel-animate">
              <h2>{t('groupPresence')}</h2>
              <ul className="presence-list">
                {studentData.groupPresence.map((presence) => (
                  <li key={`${presence.username}-${presence.lastSeen}`}>
                    <strong>{presence.displayName}</strong>
                    <span>{formatTs(presence.lastSeen)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel panel-animate">
              <h2>{t('capabilities')}</h2>
              <div className="chip-row">
                <span className="chip">canViewRoomEvents: {String(studentData.capabilities.canViewRoomEvents)}</span>
                <span className="chip">canSendDeviceCommands: {String(studentData.capabilities.canSendDeviceCommands)}</span>
                <span className="chip">canFilterByTopic: {String(studentData.capabilities.canFilterByTopic)}</span>
                <span className="chip">
                  showInternalEventsToggle: {String(studentData.capabilities.showInternalEventsToggle)}
                </span>
              </div>
            </section>

            {studentData.capabilities.canSendDeviceCommands ? (
              <section className="panel panel-animate">
                <h2>{t('commands')}</h2>
                <p className="muted">{t('ownDeviceOnly')}</p>
                <div className="button-grid">
                  {studentData.capabilities.studentCommandWhitelist.includes('LED_GREEN') ? (
                    <>
                      <button
                        className="button"
                        type="button"
                        onClick={() => sendStudentCommand('LED_GREEN', true)}
                        disabled={busyKey === 'student-command-LED_GREEN-true'}
                      >
                        {t('commandGreenOn')}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => sendStudentCommand('LED_GREEN', false)}
                        disabled={busyKey === 'student-command-LED_GREEN-false'}
                      >
                        {t('commandGreenOff')}
                      </button>
                    </>
                  ) : null}

                  {studentData.capabilities.studentCommandWhitelist.includes('LED_ORANGE') ? (
                    <>
                      <button
                        className="button"
                        type="button"
                        onClick={() => sendStudentCommand('LED_ORANGE', true)}
                        disabled={busyKey === 'student-command-LED_ORANGE-true'}
                      >
                        {t('commandOrangeOn')}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => sendStudentCommand('LED_ORANGE', false)}
                        disabled={busyKey === 'student-command-LED_ORANGE-false'}
                      >
                        {t('commandOrangeOff')}
                      </button>
                    </>
                  ) : null}

                  {studentData.capabilities.studentCommandWhitelist.includes('COUNTER_RESET') ? (
                    <button
                      className="button ghost"
                      type="button"
                      onClick={() => sendStudentCommand('COUNTER_RESET')}
                      disabled={busyKey === 'student-command-COUNTER_RESET-undefined'}
                    >
                      {t('commandCounterReset')}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="panel panel-animate feed-panel full-width">
              <h2>{t('liveFeed')}</h2>
              <div className="toolbar">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setStudentFeedPaused((value) => !value)}
                >
                  {studentFeedPaused ? t('resume') : t('pause')}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setStudentData((previous) => {
                      if (!previous) {
                        return previous;
                      }
                      return { ...previous, feed: [] };
                    });
                  }}
                >
                  {t('clear')}
                </button>

                <input
                  className="input"
                  placeholder={t('topicFilter')}
                  value={studentTopicFilter}
                  onChange={(event) => setStudentTopicFilter(event.target.value)}
                  disabled={!studentData.capabilities.canFilterByTopic}
                />

                {studentData.capabilities.showInternalEventsToggle ? (
                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={studentShowInternal}
                      onChange={(event) => setStudentShowInternal(event.target.checked)}
                    />
                    <span>{t('includeInternal')}</span>
                  </label>
                ) : null}
              </div>

              <div className="feed-table-wrap">
                <table className="feed-table">
                  <thead>
                    <tr>
                      <th>ingestTs</th>
                      <th>deviceId</th>
                      <th>eventType</th>
                      <th>topic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentVisibleFeed.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          {t('noEvents')}
                        </td>
                      </tr>
                    ) : (
                      studentVisibleFeed.map((eventItem) => (
                          <tr key={eventItem.id}>
                            <td>{formatTs(eventItem.ingestTs)}</td>
                            <td>{eventItem.deviceId}</td>
                            <td>{eventItem.eventType}</td>
                            <td className="mono">{eventItem.topic}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {!booting && session?.role === 'ADMIN' && adminData ? (
          <div className="dashboard-grid">
            <section className="panel hero panel-animate">
              <h2>{t('tasks')}</h2>
              <div className="tasks-list">
                {adminData.tasks.map((task) => (
                  <article key={task.id} className={`task-card ${task.active ? 'active' : ''}`}>
                    <header>
                      <strong>{taskTitle(task, language)}</strong>
                      {task.active ? <span className="chip">active</span> : null}
                    </header>
                    <p>{taskDescription(task, language)}</p>
                    <button
                      className="button"
                      type="button"
                      onClick={() => activateTask(task.id)}
                      disabled={busyKey === `activate-${task.id}` || task.active}
                    >
                      {t('activate')}
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel panel-animate">
              <h2>{t('settings')}</h2>
              <label>
                <span>{t('defaultLanguageMode')}</span>
                <select
                  className="input"
                  value={adminSettingsDraftMode}
                  onChange={(event) =>
                    setAdminSettingsDraftMode(event.target.value as LanguageMode)
                  }
                >
                  <option value="DE">{t('modeDe')}</option>
                  <option value="EN">{t('modeEn')}</option>
                  <option value="BROWSER_EN_FALLBACK">{t('modeBrowser')}</option>
                </select>
              </label>
              <label>
                <span>{t('timeFormat')}</span>
                <select
                  className="input"
                  value={adminSettingsDraftTimeFormat24h ? '24' : '12'}
                  onChange={(event) => setAdminSettingsDraftTimeFormat24h(event.target.value === '24')}
                >
                  <option value="24">{t('timeFormat24h')}</option>
                  <option value="12">{t('timeFormat12h')}</option>
                </select>
              </label>
              <button
                className="button"
                type="button"
                onClick={saveAdminSettings}
                disabled={busyKey === 'admin-settings'}
              >
                {t('saveSettings')}
              </button>
            </section>

            <section className="panel panel-animate">
              <h2>{t('groups')}</h2>
              <div className="groups-list">
                {adminData.groups.map((group) => (
                  <article key={group.groupKey} className="group-card">
                    <header>
                      <strong>{group.groupKey}</strong>
                      <span className="chip">online: {group.onlineCount}</span>
                    </header>
                    <p className="muted">cfg rev {group.config.revision}</p>
                    <ul>
                      {group.presence.map((presence) => (
                        <li key={`${presence.username}-${presence.lastSeen}`}>
                          {presence.displayName} - {formatTs(presence.lastSeen)}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel panel-animate full-width">
              <div className="panel-header">
                <h2>{t('devices')}</h2>
                <button
                  className="button secondary"
                  type="button"
                  onClick={refreshAdminData}
                  disabled={busyKey === 'admin-refresh'}
                >
                  {t('refresh')}
                </button>
              </div>

              <div className="devices-grid">
                {adminData.devices.map((device) => (
                  <article className="device-card" key={device.deviceId}>
                    <header>
                      <strong>{device.deviceId}</strong>
                      <span className={`chip ${device.online ? 'ok' : 'warn'}`}>
                        {statusLabel(device.online, language)}
                      </span>
                    </header>

                    <p>
                      {t('lastSeen')}: {formatTs(device.lastSeen)}
                    </p>
                    <p>
                      {t('rssi')}: {device.rssi ?? '-'}
                    </p>

                    <div className="button-grid">
                      <button
                        className="button"
                        type="button"
                        onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_GREEN', true)}
                        disabled={busyKey === `admin-command-${device.deviceId}-LED_GREEN-true`}
                      >
                        {t('commandGreenOn')}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_GREEN', false)}
                        disabled={busyKey === `admin-command-${device.deviceId}-LED_GREEN-false`}
                      >
                        {t('commandGreenOff')}
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_ORANGE', true)}
                        disabled={busyKey === `admin-command-${device.deviceId}-LED_ORANGE-true`}
                      >
                        {t('commandOrangeOn')}
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_ORANGE', false)}
                        disabled={busyKey === `admin-command-${device.deviceId}-LED_ORANGE-false`}
                      >
                        {t('commandOrangeOff')}
                      </button>
                      <button
                        className="button ghost"
                        type="button"
                        onClick={() => sendAdminDeviceCommand(device.deviceId, 'COUNTER_RESET')}
                        disabled={busyKey === `admin-command-${device.deviceId}-COUNTER_RESET-undefined`}
                      >
                        {t('commandCounterReset')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel panel-animate feed-panel full-width">
              <h2>{t('liveFeed')}</h2>
              <div className="toolbar">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setAdminFeedPaused((value) => !value)}
                >
                  {adminFeedPaused ? t('resume') : t('pause')}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => {
                    setAdminData((previous) => {
                      if (!previous) {
                        return previous;
                      }
                      return { ...previous, events: [] };
                    });
                  }}
                >
                  {t('clear')}
                </button>

                <input
                  className="input"
                  placeholder={t('topicFilter')}
                  value={adminTopicFilter}
                  onChange={(event) => setAdminTopicFilter(event.target.value)}
                />

                <input
                  className="input"
                  placeholder={t('device')}
                  value={adminDeviceFilter}
                  onChange={(event) => setAdminDeviceFilter(event.target.value)}
                />

                <select
                  className="input"
                  value={adminCategoryFilter}
                  onChange={(event) =>
                    setAdminCategoryFilter(event.target.value as EventCategory | 'ALL')
                  }
                >
                  {CATEGORY_OPTIONS.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>

                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={adminIncludeInternal}
                    onChange={(event) => setAdminIncludeInternal(event.target.checked)}
                  />
                  <span>{t('includeInternal')}</span>
                </label>
              </div>

              <div className="feed-table-wrap">
                <table className="feed-table">
                  <thead>
                    <tr>
                      <th>ingestTs</th>
                      <th>deviceId</th>
                      <th>eventType</th>
                      <th>category</th>
                      <th>topic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adminVisibleFeed.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          {t('noEvents')}
                        </td>
                      </tr>
                    ) : (
                      adminVisibleFeed.map((eventItem) => (
                          <tr key={eventItem.id}>
                            <td>{formatTs(eventItem.ingestTs)}</td>
                            <td>{eventItem.deviceId}</td>
                            <td>{eventItem.eventType}</td>
                            <td>{eventItem.category}</td>
                            <td className="mono">{eventItem.topic}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}
