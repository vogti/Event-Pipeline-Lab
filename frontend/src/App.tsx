import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import type {
  AdminSystemStatus,
  AuthMe,
  CanonicalEvent,
  DeviceCommandType,
  EventCategory,
  LanguageMode,
  PipelineCompareRow,
  PipelineProcessingSection,
  TaskPipelineConfig,
  PipelineView,
  SystemDataImportVerifyResponse,
  SystemDataPart,
  TimestampValue,
  VirtualDeviceState
} from './types';
import { type I18nKey, type Language, resolveLanguageFromMode, taskDescription, taskTitle, tr } from './i18n';
import {
  TOKEN_STORAGE_KEY,
  MAX_FEED_EVENTS,
  isAdminFeedHotPage,
  CATEGORY_OPTIONS,
  createSystemDataPartSelection,
  selectedSystemDataParts,
  systemDataPartLabel,
  MetricIcon,
  SettingsIcon,
  mergeEventsBounded,
  clampFeed,
  ipAddressToHref,
  findIpAddress,
  extractIpAddressFromDeviceStatus,
  extractIpAddressesFromEvents,
  sameTaskInfo,
  sameGroupOverviewList,
  sameAdminSystemStatus,
  sameVirtualDeviceState,
  sameVirtualDevicePatch,
  getStoredToken,
  getStoredLanguageOverride,
  setStoredLanguageOverride,
  toErrorMessage,
  formatTimestamp,
  safeConfigMap,
  statusLabel,
  sanitizeConfigForCapabilities,
  feedMatchesTopic,
  tryParsePayload,
  isTelemetryEvent,
  formatBrightnessMeasurement,
  eventValueSummary,
  buildDeviceTelemetrySnapshots,
  mergeTelemetrySnapshotCache,
  mergeIpAddressCache,
  formatRoundedDuration,
  estimateUptimeNow,
  formatRelativeFromNow,
  rssiBars,
  rssiClassName,
  patchFromVirtualDevice
} from './app/shared';
import type {
  StudentViewData,
  AdminViewData,
  WsConnectionState,
  FeedViewMode,
  EventDetailsViewMode,
  AdminPage,
  CounterResetTarget,
  VirtualDevicePatch,
  DeviceTelemetrySnapshot,
  MqttComposerMode,
  MqttComposerTargetType,
  MqttComposerTemplate,
  MqttEventDraft
} from './app/shared';
import { SystemStatusSection } from './components/admin/SystemStatusSection';
import { AdminDevicesSection } from './components/admin/AdminDevicesSection';
import { AdminFeedSection } from './components/admin/AdminFeedSection';
import { AdminMqttEventModal } from './components/admin/AdminMqttEventModal';
import { AdminDashboardSection } from './components/admin/AdminDashboardSection';
import { AdminGroupsTasksSection } from './components/admin/AdminGroupsTasksSection';
import { AdminPageNav } from './components/admin/AdminPageNav';
import { AdminSettingsSection } from './components/admin/AdminSettingsSection';
import { AppTopBar } from './components/layout/AppTopBar';
import { MainStateBanners } from './components/layout/MainStateBanners';
import { LoginSection } from './components/auth/LoginSection';
import { StudentFeedSection } from './components/student/StudentFeedSection';
import { StudentOnboardingSection } from './components/student/StudentOnboardingSection';
import { StudentOverviewSection } from './components/student/StudentOverviewSection';
import { StudentGroupConfigSection } from './components/student/StudentGroupConfigSection';
import { StudentPresenceSection } from './components/student/StudentPresenceSection';
import { StudentCapabilitiesSection } from './components/student/StudentCapabilitiesSection';
import { StudentCommandsSection } from './components/student/StudentCommandsSection';
import { StudentVirtualDeviceSection } from './components/student/StudentVirtualDeviceSection';
import { AppModals } from './components/AppModals';
import { PipelineBuilderSection } from './components/pipeline/PipelineBuilderSection';
import { PipelineTaskConfigSection } from './components/pipeline/PipelineTaskConfigSection';
import { PipelineCompareSection } from './components/pipeline/PipelineCompareSection';
import { useAdminSystemStatusPolling } from './hooks/useAdminSystemStatusPolling';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import {
  buildGuidedMqttMessage,
  createMqttEventDraft,
  normalizeMqttTemplateForTarget,
  resolveMqttDeviceId
} from './app/mqtt-composer';

function parsePipelineListInput(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index);
}

function setPipelineSlotBlock(
  processing: PipelineProcessingSection,
  slotIndex: number,
  blockType: string
): PipelineProcessingSection {
  const nextSlots = processing.slots.some((slot) => slot.index === slotIndex)
    ? processing.slots.map((slot) =>
        slot.index === slotIndex ? { ...slot, blockType } : slot
      )
    : [...processing.slots, { index: slotIndex, blockType, config: {} }];

  return {
    ...processing,
    slots: nextSlots.sort((a, b) => a.index - b.index)
  };
}

function toggleStringInList(values: string[], value: string, enabled: boolean): string[] {
  if (enabled) {
    if (values.includes(value)) {
      return values;
    }
    return [...values, value];
  }
  return values.filter((entry) => entry !== value);
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
  const [studentOnboardingDone, setStudentOnboardingDone] = useState(false);
  const [studentPipeline, setStudentPipeline] = useState<PipelineView | null>(null);
  const [studentPipelineDraft, setStudentPipelineDraft] = useState<PipelineProcessingSection | null>(null);

  const [adminData, setAdminData] = useState<AdminViewData | null>(null);
  const [adminSystemStatus, setAdminSystemStatus] = useState<AdminSystemStatus | null>(null);
  const [adminTopicFilter, setAdminTopicFilter] = useState('');
  const [adminCategoryFilter, setAdminCategoryFilter] = useState<EventCategory | 'ALL'>('ALL');
  const [adminDeviceFilter, setAdminDeviceFilter] = useState('');
  const [adminIncludeInternal, setAdminIncludeInternal] = useState(false);
  const [adminFeedPaused, setAdminFeedPaused] = useState(false);
  const [adminSettingsDraftMode, setAdminSettingsDraftMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [adminSettingsDraftTimeFormat24h, setAdminSettingsDraftTimeFormat24h] = useState(true);
  const [adminSettingsDraftVirtualVisible, setAdminSettingsDraftVirtualVisible] = useState(true);
  const [adminDeviceSnapshots, setAdminDeviceSnapshots] = useState<Record<string, DeviceTelemetrySnapshot>>({});
  const [adminDeviceIpById, setAdminDeviceIpById] = useState<Record<string, string>>({});
  const [adminPipeline, setAdminPipeline] = useState<PipelineView | null>(null);
  const [adminPipelineDraft, setAdminPipelineDraft] = useState<PipelineView | null>(null);
  const [adminPipelineGroupKey, setAdminPipelineGroupKey] = useState('');
  const [adminPipelineTaskId, setAdminPipelineTaskId] = useState('');
  const [adminTaskPipelineConfig, setAdminTaskPipelineConfig] = useState<TaskPipelineConfig | null>(null);
  const [adminTaskPipelineConfigDraft, setAdminTaskPipelineConfigDraft] = useState<TaskPipelineConfig | null>(null);
  const [adminPipelineCompareRows, setAdminPipelineCompareRows] = useState<PipelineCompareRow[]>([]);
  const [studentVirtualPatch, setStudentVirtualPatch] = useState<VirtualDevicePatch | null>(null);
  const [virtualControlDeviceId, setVirtualControlDeviceId] = useState<string | null>(null);
  const [virtualControlPatch, setVirtualControlPatch] = useState<VirtualDevicePatch | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [wsConnection, setWsConnection] = useState<WsConnectionState>('disconnected');

  const [defaultLanguageMode, setDefaultLanguageMode] = useState<LanguageMode>('BROWSER_EN_FALLBACK');
  const [timeFormat24h, setTimeFormat24h] = useState(true);
  const [languageOverride, setLanguageOverride] = useState<Language | null>(() => getStoredLanguageOverride());
  const [feedViewMode, setFeedViewMode] = useState<FeedViewMode>('rendered');
  const [selectedEvent, setSelectedEvent] = useState<CanonicalEvent | null>(null);
  const [eventDetailsViewMode, setEventDetailsViewMode] = useState<EventDetailsViewMode>('rendered');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [nowEpochMs, setNowEpochMs] = useState<number>(() => Date.now());
  const [counterResetTarget, setCounterResetTarget] = useState<CounterResetTarget | null>(null);
  const [resetEventsModalOpen, setResetEventsModalOpen] = useState(false);
  const [pinEditorDeviceId, setPinEditorDeviceId] = useState<string | null>(null);
  const [pinEditorValue, setPinEditorValue] = useState('');
  const [pinEditorLoading, setPinEditorLoading] = useState(false);
  const [mqttModalOpen, setMqttModalOpen] = useState(false);
  const [mqttComposerMode, setMqttComposerMode] = useState<MqttComposerMode>('guided');
  const [mqttEventDraft, setMqttEventDraft] = useState<MqttEventDraft>(() => createMqttEventDraft());
  const [adminPage, setAdminPage] = useState<AdminPage>('dashboard');
  const [recentFeedEventIds, setRecentFeedEventIds] = useState<Record<string, true>>({});
  const [systemDataExportSelection, setSystemDataExportSelection] = useState<Record<SystemDataPart, boolean>>(
    () => createSystemDataPartSelection(true)
  );
  const [systemDataImportFileName, setSystemDataImportFileName] = useState('');
  const [systemDataImportFile, setSystemDataImportFile] = useState<File | null>(null);
  const [systemDataImportVerify, setSystemDataImportVerify] = useState<SystemDataImportVerifyResponse | null>(null);
  const [systemDataImportSelection, setSystemDataImportSelection] = useState<Record<SystemDataPart, boolean>>(
    () => createSystemDataPartSelection(false)
  );

  const studentPauseRef = useRef(studentFeedPaused);
  const adminPauseRef = useRef(adminFeedPaused);
  const adminDataRef = useRef<AdminViewData | null>(null);
  const adminPageRef = useRef(adminPage);
  const deferredAdminFeedRef = useRef<CanonicalEvent[]>([]);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const recentFeedClearTimerRef = useRef<number | null>(null);
  const adminPipelineGroupKeyRef = useRef<string>('');

  const reportBackgroundError = useCallback((context: string, error: unknown) => {
    const message = toErrorMessage(error);
    console.warn(`[EPL UI background] ${context}: ${message}`);
  }, []);

  const clearRecentFeedHighlights = useCallback(() => {
    if (recentFeedClearTimerRef.current !== null) {
      window.clearTimeout(recentFeedClearTimerRef.current);
      recentFeedClearTimerRef.current = null;
    }
    setRecentFeedEventIds((previous) => (Object.keys(previous).length === 0 ? previous : {}));
  }, []);

  const markFeedEventsRecent = useCallback((events: CanonicalEvent[]) => {
    if (events.length === 0) {
      return;
    }
    setRecentFeedEventIds((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const event of events) {
        if (next[event.id]) {
          continue;
        }
        next[event.id] = true;
        changed = true;
      }
      return changed ? next : previous;
    });
    if (recentFeedClearTimerRef.current !== null) {
      window.clearTimeout(recentFeedClearTimerRef.current);
    }
    recentFeedClearTimerRef.current = window.setTimeout(() => {
      recentFeedClearTimerRef.current = null;
      setRecentFeedEventIds((previous) => (Object.keys(previous).length === 0 ? previous : {}));
    }, 1000);
  }, []);

  const queueDeferredAdminFeedEvents = useCallback((events: CanonicalEvent[]) => {
    if (events.length === 0) {
      return;
    }
    deferredAdminFeedRef.current = mergeEventsBounded(
      deferredAdminFeedRef.current,
      events,
      MAX_FEED_EVENTS
    );
  }, []);

  const flushDeferredAdminFeedEvents = useCallback(
    (highlight: boolean) => {
      if (!adminDataRef.current) {
        return;
      }
      const deferredEvents = deferredAdminFeedRef.current;
      if (deferredEvents.length === 0) {
        return;
      }

      deferredAdminFeedRef.current = [];
      if (highlight) {
        markFeedEventsRecent(deferredEvents);
      }
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        const nextFeed = mergeEventsBounded(previous.events, deferredEvents, MAX_FEED_EVENTS);
        if (nextFeed === previous.events) {
          return previous;
        }
        return {
          ...previous,
          events: nextFeed
        };
      });
    },
    [markFeedEventsRecent]
  );

  useEffect(() => {
    studentPauseRef.current = studentFeedPaused;
  }, [studentFeedPaused]);

  useEffect(() => {
    adminPageRef.current = adminPage;
  }, [adminPage]);

  useEffect(() => {
    adminPipelineGroupKeyRef.current = adminPipelineGroupKey;
  }, [adminPipelineGroupKey]);

  useEffect(() => {
    adminDataRef.current = adminData;
  }, [adminData]);

  useEffect(() => {
    if (!isAdminFeedHotPage(adminPage)) {
      return;
    }
    flushDeferredAdminFeedEvents(adminPage === 'feed');
  }, [adminPage, flushDeferredAdminFeedEvents]);

  useEffect(() => {
    if (adminPage !== 'devices') {
      return;
    }
    const deferredEvents = deferredAdminFeedRef.current;
    if (deferredEvents.length === 0) {
      return;
    }

    const latestSnapshots = buildDeviceTelemetrySnapshots(deferredEvents);
    if (Object.keys(latestSnapshots).length > 0) {
      setAdminDeviceSnapshots((previous) => mergeTelemetrySnapshotCache(previous, latestSnapshots));
    }

    const latestIpByDeviceId = extractIpAddressesFromEvents(deferredEvents);
    if (Object.keys(latestIpByDeviceId).length > 0) {
      setAdminDeviceIpById((previous) => {
        const activeDeviceIds =
          adminDataRef.current?.devices.map((device) => device.deviceId) ??
          Array.from(new Set([...Object.keys(previous), ...Object.keys(latestIpByDeviceId)]));
        return mergeIpAddressCache(previous, latestIpByDeviceId, activeDeviceIds);
      });
    }
  }, [adminPage]);

  useEffect(() => {
    return () => {
      clearRecentFeedHighlights();
    };
  }, [clearRecentFeedHighlights]);

  useEffect(() => {
    adminPauseRef.current = adminFeedPaused;
  }, [adminFeedPaused]);

  useEffect(() => {
    if (!errorMessage) {
      return;
    }
    const timer = window.setTimeout(() => {
      setErrorMessage(null);
    }, 6000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [errorMessage]);

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
    setStudentOnboardingDone(false);
    setStudentPipeline(null);
    setStudentPipelineDraft(null);

    setAdminData(null);
    setAdminSystemStatus(null);
    setAdminTopicFilter('');
    setAdminCategoryFilter('ALL');
    setAdminDeviceFilter('');
    setAdminIncludeInternal(false);
    setAdminFeedPaused(false);
    setAdminSettingsDraftMode('BROWSER_EN_FALLBACK');
    setAdminSettingsDraftTimeFormat24h(true);
    setAdminSettingsDraftVirtualVisible(true);
    setAdminDeviceSnapshots({});
    setAdminDeviceIpById({});
    setAdminPipeline(null);
    setAdminPipelineDraft(null);
    setAdminPipelineGroupKey('');
    setAdminPipelineTaskId('');
    setAdminTaskPipelineConfig(null);
    setAdminTaskPipelineConfigDraft(null);
    setAdminPipelineCompareRows([]);
    adminPipelineGroupKeyRef.current = '';
    setStudentVirtualPatch(null);
    setVirtualControlDeviceId(null);
    setVirtualControlPatch(null);
    setCounterResetTarget(null);
    setResetEventsModalOpen(false);
    setPinEditorDeviceId(null);
    setPinEditorValue('');
    setPinEditorLoading(false);
    setMqttModalOpen(false);
    setMqttComposerMode('guided');
    setMqttEventDraft(createMqttEventDraft());
    setAdminPage('dashboard');
    setSystemDataExportSelection(createSystemDataPartSelection(true));
    setSystemDataImportFileName('');
    setSystemDataImportFile(null);
    setSystemDataImportVerify(null);
    setSystemDataImportSelection(createSystemDataPartSelection(false));
    adminDataRef.current = null;
    deferredAdminFeedRef.current = [];
    clearRecentFeedHighlights();
  }, [clearRecentFeedHighlights]);

  const clearAuth = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
    setToken(null);
    setSession(null);
    setUserMenuOpen(false);
    setWsConnection('disconnected');
    clearRoleState();
  }, [clearRoleState]);

  const refreshAdminGroups = useCallback(async (activeToken: string) => {
    const groups = await api.adminGroups(activeToken);
    setAdminData((previous) => {
      if (!previous) {
        return previous;
      }
      if (sameGroupOverviewList(previous.groups, groups)) {
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
      if (
        previous.tasks.length === tasks.length &&
        previous.tasks.every((task, index) => sameTaskInfo(task, tasks[index]))
      ) {
        return previous;
      }
      return { ...previous, tasks };
    });
  }, []);

  const loadAdminPipelineForGroup = useCallback(
    async (groupKey: string) => {
      if (!token) {
        return;
      }
      if (!groupKey) {
        setAdminPipeline(null);
        setAdminPipelineDraft(null);
        return;
      }

      setBusyKey('admin-pipeline-load');
      setErrorMessage(null);
      try {
        const view = await api.adminPipeline(token, groupKey);
        setAdminPipeline(view);
        setAdminPipelineDraft(view);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyKey(null);
      }
    },
    [token]
  );

  const loadAdminTaskPipelineConfig = useCallback(
    async (taskId: string) => {
      if (!token || !taskId) {
        setAdminTaskPipelineConfig(null);
        setAdminTaskPipelineConfigDraft(null);
        return;
      }

      setBusyKey('admin-task-pipeline-config-load');
      setErrorMessage(null);
      try {
        const config = await api.adminTaskPipelineConfig(token, taskId);
        setAdminTaskPipelineConfig(config);
        setAdminTaskPipelineConfigDraft(config);
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyKey(null);
      }
    },
    [token]
  );

  const loadAdminPipelineCompare = useCallback(async () => {
    if (!token) {
      setAdminPipelineCompareRows([]);
      return;
    }
    try {
      const rows = await api.adminPipelineCompare(token);
      setAdminPipelineCompareRows(rows);
    } catch (error) {
      reportBackgroundError('adminPipelineCompare', error);
    }
  }, [reportBackgroundError, token]);

  const loadDashboards = useCallback(async (auth: AuthMe, activeToken: string) => {
    if (auth.role === 'STUDENT') {
      const [bootstrap, pipeline] = await Promise.all([
        api.studentBootstrap(activeToken),
        api.studentPipeline(activeToken)
      ]);
      setStudentData({
        activeTask: bootstrap.activeTask,
        capabilities: bootstrap.capabilities,
        groupConfig: bootstrap.groupConfig,
        groupPresence: bootstrap.groupPresence,
        feed: clampFeed(bootstrap.recentFeed),
        virtualDevice: bootstrap.virtualDevice,
        settings: bootstrap.settings
      });
      setStudentConfigDraft(safeConfigMap(bootstrap.groupConfig.config));
      setDisplayNameDraft(bootstrap.me.displayName);
      setStudentVirtualPatch(bootstrap.virtualDevice ? patchFromVirtualDevice(bootstrap.virtualDevice) : null);
      setStudentOnboardingDone(false);
      setDefaultLanguageMode(bootstrap.settings.defaultLanguageMode);
      setTimeFormat24h(bootstrap.settings.timeFormat24h);
      setStudentPipeline(pipeline);
      setStudentPipelineDraft(pipeline.processing);
      return;
    }

    const [tasks, devices, virtualDevices, groups, settings, events, systemStatus] = await Promise.all([
      api.adminTasks(activeToken),
      api.adminDevices(activeToken),
      api.adminVirtualDevices(activeToken),
      api.adminGroups(activeToken),
      api.adminSettings(activeToken),
      api.eventsFeed(activeToken, { limit: MAX_FEED_EVENTS, includeInternal: true }),
      api.adminSystemStatus(activeToken)
    ]);

    setAdminData({
      tasks,
      devices,
      virtualDevices,
      groups,
      settings,
      events: clampFeed(events)
    });
    deferredAdminFeedRef.current = [];
    setAdminSettingsDraftMode(settings.defaultLanguageMode);
    setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
    setAdminSettingsDraftVirtualVisible(settings.studentVirtualDeviceVisible);
    setDefaultLanguageMode(settings.defaultLanguageMode);
    setTimeFormat24h(settings.timeFormat24h);
    setAdminSystemStatus(systemStatus);
    setAdminPage('dashboard');

    const initialGroupKey = groups[0]?.groupKey ?? '';
    const initialTaskId = tasks.find((task) => task.active)?.id ?? tasks[0]?.id ?? '';
    setAdminPipelineGroupKey(initialGroupKey);
    setAdminPipelineTaskId(initialTaskId);
    adminPipelineGroupKeyRef.current = initialGroupKey;

    const pipelinePromise = initialGroupKey
      ? api.adminPipeline(activeToken, initialGroupKey)
      : Promise.resolve<PipelineView | null>(null);
    const taskConfigPromise = initialTaskId
      ? api.adminTaskPipelineConfig(activeToken, initialTaskId)
      : Promise.resolve<TaskPipelineConfig | null>(null);
    const comparePromise = api.adminPipelineCompare(activeToken);

    const [pipeline, taskConfig, compareRows] = await Promise.all([
      pipelinePromise,
      taskConfigPromise,
      comparePromise
    ]);

    setAdminPipeline(pipeline);
    setAdminPipelineDraft(pipeline);
    setAdminTaskPipelineConfig(taskConfig);
    setAdminTaskPipelineConfigDraft(taskConfig);
    setAdminPipelineCompareRows(compareRows);
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

  const studentActiveTaskId = studentData?.activeTask.id ?? '';
  const hasStudentData = studentData !== null;

  useEffect(() => {
    if (!token || session?.role !== 'STUDENT' || !hasStudentData) {
      return;
    }

    let cancelled = false;
    api.studentPipeline(token)
      .then((view) => {
        if (cancelled) {
          return;
        }
        setStudentPipeline(view);
        setStudentPipelineDraft(view.processing);
      })
      .catch((error) => reportBackgroundError('studentPipeline', error));

    return () => {
      cancelled = true;
    };
  }, [token, session?.role, hasStudentData, studentActiveTaskId, reportBackgroundError]);

  const adminGroupKeysSignature = useMemo(
    () => (adminData?.groups ?? []).map((group) => group.groupKey).join('|'),
    [adminData?.groups]
  );
  const adminTaskIdsSignature = useMemo(
    () => (adminData?.tasks ?? []).map((task) => task.id).join('|'),
    [adminData?.tasks]
  );
  const adminTaskActivitySignature = useMemo(
    () => (adminData?.tasks ?? []).map((task) => `${task.id}:${task.active}`).join('|'),
    [adminData?.tasks]
  );
  const adminGroups = useMemo(() => adminData?.groups ?? [], [adminData?.groups]);
  const adminTasks = useMemo(() => adminData?.tasks ?? [], [adminData?.tasks]);
  const hasAdminData = adminData !== null;

  useEffect(() => {
    const groupKeys = adminGroups.map((group) => group.groupKey);
    if (groupKeys.length === 0) {
      setAdminPipelineGroupKey('');
      adminPipelineGroupKeyRef.current = '';
      setAdminPipeline(null);
      setAdminPipelineDraft(null);
      return;
    }
    if (!adminPipelineGroupKey || !groupKeys.includes(adminPipelineGroupKey)) {
      const firstGroupKey = groupKeys[0];
      setAdminPipelineGroupKey(firstGroupKey);
      adminPipelineGroupKeyRef.current = firstGroupKey;
      void loadAdminPipelineForGroup(firstGroupKey);
    }
  }, [adminGroupKeysSignature, adminGroups, adminPipelineGroupKey, loadAdminPipelineForGroup]);

  useEffect(() => {
    const taskIds = adminTasks.map((task) => task.id);
    if (taskIds.length === 0) {
      setAdminPipelineTaskId('');
      setAdminTaskPipelineConfig(null);
      setAdminTaskPipelineConfigDraft(null);
      return;
    }
    if (!adminPipelineTaskId || !taskIds.includes(adminPipelineTaskId)) {
      const activeTaskId = adminTasks.find((task) => task.active)?.id ?? taskIds[0];
      setAdminPipelineTaskId(activeTaskId);
      void loadAdminTaskPipelineConfig(activeTaskId);
    }
  }, [adminTaskIdsSignature, adminTasks, adminPipelineTaskId, loadAdminTaskPipelineConfig]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || !adminPipelineGroupKey || !hasAdminData) {
      return;
    }
    void loadAdminPipelineForGroup(adminPipelineGroupKey);
  }, [
    token,
    session?.role,
    hasAdminData,
    adminPipelineGroupKey,
    adminTaskActivitySignature,
    loadAdminPipelineForGroup
  ]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || !adminPipelineTaskId || !hasAdminData) {
      return;
    }
    void loadAdminTaskPipelineConfig(adminPipelineTaskId);
  }, [token, session?.role, adminPipelineTaskId, hasAdminData, loadAdminTaskPipelineConfig]);

  useEffect(() => {
    if (!token || session?.role !== 'ADMIN' || !hasAdminData) {
      return;
    }
    void loadAdminPipelineCompare();
  }, [
    token,
    session?.role,
    hasAdminData,
    adminGroupKeysSignature,
    adminTaskActivitySignature,
    loadAdminPipelineCompare
  ]);

  useEffect(() => {
    const virtualDevice = studentData?.virtualDevice;
    if (!virtualDevice) {
      setStudentVirtualPatch(null);
      return;
    }
    setStudentVirtualPatch((previous) => {
      if (!previous) {
        return patchFromVirtualDevice(virtualDevice);
      }
      return previous;
    });
  }, [studentData?.virtualDevice]);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedEvent(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedEvent]);

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current) {
        return;
      }
      if (userMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setUserMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!counterResetTarget) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCounterResetTarget(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [counterResetTarget]);

  useEffect(() => {
    if (!resetEventsModalOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setResetEventsModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [resetEventsModalOpen]);

  useEffect(() => {
    if (!pinEditorDeviceId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinEditorDeviceId(null);
        setPinEditorValue('');
        setPinEditorLoading(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [pinEditorDeviceId]);

  useEffect(() => {
    if (!virtualControlDeviceId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVirtualControlDeviceId(null);
        setVirtualControlPatch(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [virtualControlDeviceId]);

  useEffect(() => {
    if (!mqttModalOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMqttModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mqttModalOpen]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNowEpochMs(Date.now());
    }, 60_000);
    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    if (!adminData) {
      setAdminDeviceSnapshots({});
      setAdminDeviceIpById({});
    }
  }, [adminData]);

  useEffect(() => {
    const adminEvents = adminData?.events;
    if (!adminEvents || adminPage !== 'devices') {
      return;
    }

    const latestSnapshots = buildDeviceTelemetrySnapshots(adminEvents);
    if (Object.keys(latestSnapshots).length > 0) {
      setAdminDeviceSnapshots((previous) => mergeTelemetrySnapshotCache(previous, latestSnapshots));
    }
  }, [adminData?.events, adminPage]);

  useEffect(() => {
    const adminDevices = adminData?.devices;
    const adminEvents = adminData?.events;
    if (!adminDevices || !adminEvents || adminPage !== 'devices') {
      return;
    }

    const latestIpByDeviceId: Record<string, string> = {};
    for (const device of adminDevices) {
      const ipAddress = extractIpAddressFromDeviceStatus(device, adminEvents);
      if (ipAddress) {
        latestIpByDeviceId[device.deviceId] = ipAddress;
      }
    }
    setAdminDeviceIpById((previous) =>
      mergeIpAddressCache(
        previous,
        latestIpByDeviceId,
        adminDevices.map((device) => device.deviceId)
      )
    );
  }, [adminData?.devices, adminData?.events, adminPage]);

  useEffect(() => {
    const adminDevices = adminData?.devices;
    if (!adminDevices || adminPage !== 'devices') {
      return;
    }

    const latestWifiIpByDeviceId: Record<string, string> = {};
    for (const device of adminDevices) {
      if (!device.wifiPayloadJson) {
        continue;
      }
      const ipAddress = findIpAddress(tryParsePayload(device.wifiPayloadJson));
      if (ipAddress) {
        latestWifiIpByDeviceId[device.deviceId] = ipAddress;
      }
    }
    if (Object.keys(latestWifiIpByDeviceId).length === 0) {
      return;
    }
    setAdminDeviceIpById((previous) =>
      mergeIpAddressCache(
        previous,
        latestWifiIpByDeviceId,
        adminDevices.map((device) => device.deviceId)
      )
    );
  }, [adminData?.devices, adminPage]);

  useAdminSystemStatusPolling({
    token,
    role: session?.role ?? null,
    adminPage,
    reportBackgroundError,
    setAdminSystemStatus
  });

  const applyStudentPipelineFromWs = useCallback((view: PipelineView) => {
    setStudentPipeline((previous) => {
      if (
        previous &&
        previous.taskId === view.taskId &&
        previous.groupKey === view.groupKey &&
        previous.revision === view.revision
      ) {
        return previous;
      }
      return view;
    });
    setStudentPipelineDraft(view.processing);
  }, []);

  const applyAdminPipelineFromWs = useCallback((view: PipelineView) => {
    setAdminPipeline((previous) => {
      if (
        previous &&
        previous.taskId === view.taskId &&
        previous.groupKey === view.groupKey &&
        previous.revision === view.revision
      ) {
        return previous;
      }
      return view;
    });
    setAdminPipelineDraft(view);
  }, []);

  const applyAdminPipelineObservedFromWs = useCallback((view: PipelineView, selectedGroupKey: string) => {
    setAdminPipelineCompareRows((previous) => {
      const nextRow: PipelineCompareRow = {
        taskId: view.taskId,
        groupKey: view.groupKey,
        revision: view.revision,
        updatedAt: view.updatedAt,
        updatedBy: view.updatedBy,
        slotBlocks: Array.from({ length: view.processing.slotCount }).map((_, index) => {
          const slot = view.processing.slots.find((entry) => entry.index === index);
          return slot?.blockType ?? 'NONE';
        })
      };

      const existingIndex = previous.findIndex((row) => row.groupKey === view.groupKey);
      const next = existingIndex >= 0
        ? previous.map((row, index) => (index === existingIndex ? nextRow : row))
        : [...previous, nextRow];

      return [...next].sort((left, right) => left.groupKey.localeCompare(right.groupKey));
    });

    if (view.groupKey === selectedGroupKey) {
      setAdminPipeline(view);
      setAdminPipelineDraft(view);
    }
  }, []);

  useRealtimeSync({
    session,
    token,
    studentPauseRef,
    adminPauseRef,
    adminDataRef,
    adminPageRef,
    reportBackgroundError,
    refreshAdminGroups,
    refreshAdminTasks,
    markFeedEventsRecent,
    queueDeferredAdminFeedEvents,
    flushDeferredAdminFeedEvents,
    setWsConnection,
    setErrorMessage,
    setStudentData,
    setStudentConfigDraft,
    setStudentVirtualPatch,
    setAdminData,
    setAdminDeviceSnapshots,
    setAdminDeviceIpById,
    setAdminSettingsDraftMode,
    setAdminSettingsDraftTimeFormat24h,
    setAdminSettingsDraftVirtualVisible,
    setDefaultLanguageMode,
    setTimeFormat24h,
    selectedAdminPipelineGroupKeyRef: adminPipelineGroupKeyRef,
    onStudentPipelineUpdated: applyStudentPipelineFromWs,
    onAdminPipelineUpdated: applyAdminPipelineFromWs,
    onAdminPipelineObserved: applyAdminPipelineObservedFromWs
  });

  const adminPhysicalDeviceIds = useMemo(() => {
    return adminData?.devices.map((entry) => entry.deviceId) ?? [];
  }, [adminData?.devices]);

  const adminVirtualDeviceIds = useMemo(() => {
    return adminData?.virtualDevices.map((entry) => entry.deviceId) ?? [];
  }, [adminData?.virtualDevices]);

  const guidedMqttMessage = useMemo(() => {
    return buildGuidedMqttMessage(mqttEventDraft);
  }, [mqttEventDraft]);

  useEffect(() => {
    if (mqttComposerMode !== 'guided') {
      return;
    }
    setMqttEventDraft((previous) => {
      if (
        previous.rawTopic === guidedMqttMessage.topic &&
        previous.rawPayload === guidedMqttMessage.payload
      ) {
        return previous;
      }
      return {
        ...previous,
        rawTopic: guidedMqttMessage.topic,
        rawPayload: guidedMqttMessage.payload
      };
    });
  }, [guidedMqttMessage.payload, guidedMqttMessage.topic, mqttComposerMode]);

  const handleLogin = async () => {
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

  const continueStudentOnboarding = async () => {
    if (!token || !session || session.role !== 'STUDENT') {
      return;
    }

    const nextDisplayName = displayNameDraft.trim();
    if (nextDisplayName.length === 0) {
      setErrorMessage(t('onboardingNameRequired'));
      return;
    }

    setBusyKey('student-onboarding');
    setErrorMessage(null);

    try {
      if (nextDisplayName !== session.displayName) {
        const updated = await api.updateDisplayName(token, nextDisplayName);
        setSession(updated);
        setDisplayNameDraft(updated.displayName);
      }
      setStudentOnboardingDone(true);
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

  const saveStudentPipeline = async () => {
    if (!token || !studentPipelineDraft) {
      return;
    }

    setBusyKey('student-pipeline');
    setErrorMessage(null);

    try {
      const updated = await api.updateStudentPipeline(token, studentPipelineDraft);
      setStudentPipeline(updated);
      setStudentPipelineDraft(updated.processing);
      setInfoMessage(t('pipelineUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const changeStudentPipelineSlot = useCallback((slotIndex: number, blockType: string) => {
    setStudentPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return setPipelineSlotBlock(previous, slotIndex, blockType);
    });
  }, []);

  const selectAdminPipelineGroup = useCallback(
    (groupKey: string) => {
      setAdminPipelineGroupKey(groupKey);
      adminPipelineGroupKeyRef.current = groupKey;
      void loadAdminPipelineForGroup(groupKey);
    },
    [loadAdminPipelineForGroup]
  );

  const saveAdminPipeline = async () => {
    if (!token || !adminPipelineDraft || !adminPipelineGroupKey) {
      return;
    }

    setBusyKey('admin-pipeline');
    setErrorMessage(null);
    try {
      const updated = await api.updateAdminPipeline(
        token,
        adminPipelineGroupKey,
        adminPipelineDraft.input,
        adminPipelineDraft.processing,
        adminPipelineDraft.sink
      );
      setAdminPipeline(updated);
      setAdminPipelineDraft(updated);
      setInfoMessage(t('pipelineUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const changeAdminPipelineSlot = useCallback((slotIndex: number, blockType: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        processing: setPipelineSlotBlock(previous.processing, slotIndex, blockType)
      };
    });
  }, []);

  const changeAdminPipelineInputMode = useCallback((nextMode: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        input: {
          ...previous.input,
          mode: nextMode
        }
      };
    });
  }, []);

  const changeAdminPipelineDeviceScope = useCallback((nextScope: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        input: {
          ...previous.input,
          deviceScope: nextScope
        }
      };
    });
  }, []);

  const changeAdminPipelineIngestFilters = useCallback((raw: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        input: {
          ...previous.input,
          ingestFilters: parsePipelineListInput(raw)
        }
      };
    });
  }, []);

  const changeAdminPipelineScenarioOverlays = useCallback((raw: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        input: {
          ...previous.input,
          scenarioOverlays: parsePipelineListInput(raw)
        }
      };
    });
  }, []);

  const changeAdminPipelineSinkTargets = useCallback((raw: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sink: {
          ...previous.sink,
          targets: parsePipelineListInput(raw)
        }
      };
    });
  }, []);

  const changeAdminPipelineSinkGoal = useCallback((goal: string) => {
    setAdminPipelineDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        sink: {
          ...previous.sink,
          goal
        }
      };
    });
  }, []);

  const selectAdminPipelineTask = useCallback(
    (taskId: string) => {
      setAdminPipelineTaskId(taskId);
      void loadAdminTaskPipelineConfig(taskId);
    },
    [loadAdminTaskPipelineConfig]
  );

  const changeTaskPipelineVisibleToStudents = useCallback((visible: boolean) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        visibleToStudents: visible
      };
    });
  }, []);

  const changeTaskPipelineSlotCount = useCallback((slotCount: number) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      const clamped = Math.max(previous.minSlotCount, Math.min(previous.maxSlotCount, Math.round(slotCount)));
      return {
        ...previous,
        slotCount: clamped
      };
    });
  }, []);

  const toggleTaskPipelineAllowedBlock = useCallback((blockType: string, enabled: boolean) => {
    setAdminTaskPipelineConfigDraft((previous) => {
      if (!previous) {
        return previous;
      }
      const nextAllowed = toggleStringInList(previous.allowedProcessingBlocks, blockType, enabled);
      if (nextAllowed.length === 0) {
        return previous;
      }
      return {
        ...previous,
        allowedProcessingBlocks: nextAllowed
      };
    });
  }, []);

  const saveAdminTaskPipelineConfig = async () => {
    if (!token || !adminTaskPipelineConfigDraft) {
      return;
    }

    setBusyKey('admin-task-pipeline-config');
    setErrorMessage(null);
    try {
      const updated = await api.updateAdminTaskPipelineConfig(
        token,
        adminTaskPipelineConfigDraft.taskId,
        adminTaskPipelineConfigDraft.visibleToStudents,
        adminTaskPipelineConfigDraft.slotCount,
        adminTaskPipelineConfigDraft.allowedProcessingBlocks
      );
      setAdminTaskPipelineConfig(updated);
      setAdminTaskPipelineConfigDraft(updated);
      setInfoMessage(t('pipelineTaskConfigSaved'));

      const activeTaskId = adminData?.tasks.find((task) => task.active)?.id ?? '';
      if (activeTaskId && activeTaskId === updated.taskId) {
        if (adminPipelineGroupKey) {
          await loadAdminPipelineForGroup(adminPipelineGroupKey);
        }
        await loadAdminPipelineCompare();
      }
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
      setAdminPipelineTaskId(task.id);
      void loadAdminTaskPipelineConfig(task.id);
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
        adminSettingsDraftTimeFormat24h,
        adminSettingsDraftVirtualVisible
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
      setAdminSettingsDraftVirtualVisible(updated.studentVirtualDeviceVisible);
      setInfoMessage(t('settingsUpdated'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const sendAdminDeviceCommand = useCallback(
    async (
      deviceId: string,
      command: DeviceCommandType,
      on?: boolean
    ): Promise<boolean> => {
      if (!token) {
        return false;
      }

      setBusyKey(`admin-command-${deviceId}-${command}-${String(on)}`);
      setErrorMessage(null);

      try {
        await api.adminDeviceCommand(token, deviceId, command, on);
        return true;
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [token]
  );

  const setStudentVirtualField = useCallback(<K extends keyof VirtualDevicePatch>(key: K, value: VirtualDevicePatch[K]) => {
    setStudentVirtualPatch((previous) => {
      if (previous && previous[key] === value) {
        return previous;
      }
      const base = previous ?? {};
      return {
        ...base,
        [key]: value
      };
    });
  }, []);

  const setModalVirtualField = useCallback(<K extends keyof VirtualDevicePatch>(key: K, value: VirtualDevicePatch[K]) => {
    setVirtualControlPatch((previous) => {
      if (previous && previous[key] === value) {
        return previous;
      }
      const base = previous ?? {};
      return {
        ...base,
        [key]: value
      };
    });
  }, []);

  const saveStudentVirtualDevice = async () => {
    if (!token || !studentVirtualPatch || !studentData?.virtualDevice) {
      return;
    }

    setBusyKey('student-virtual-control');
    setErrorMessage(null);

    try {
      const updated = await api.studentVirtualDeviceControl(token, studentVirtualPatch);
      setStudentData((previous) => {
        if (!previous) {
          return previous;
        }
        if (previous.virtualDevice && sameVirtualDeviceState(previous.virtualDevice, updated)) {
          return previous;
        }
        return {
          ...previous,
          virtualDevice: updated
        };
      });
      const nextPatch = patchFromVirtualDevice(updated);
      setStudentVirtualPatch((previous) => (sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const openVirtualControlModal = useCallback((deviceId: string) => {
    setVirtualControlDeviceId(deviceId);
    const state = adminDataRef.current?.virtualDevices.find((entry) => entry.deviceId === deviceId) ?? null;
    setVirtualControlPatch(state ? patchFromVirtualDevice(state) : null);
  }, []);

  const closeVirtualControlModal = useCallback(() => {
    setVirtualControlDeviceId(null);
    setVirtualControlPatch(null);
  }, []);

  const applyUpdatedVirtualDevice = useCallback((updated: VirtualDeviceState) => {
    setAdminData((previous) => {
      if (!previous) {
        return previous;
      }
      const existing = previous.virtualDevices.find((entry) => entry.deviceId === updated.deviceId);
      if (existing && sameVirtualDeviceState(existing, updated)) {
        return previous;
      }
      const hasExisting = Boolean(existing);
      const nextVirtualDevices = hasExisting
        ? previous.virtualDevices.map((entry) =>
            entry.deviceId === updated.deviceId ? updated : entry
          )
        : [...previous.virtualDevices, updated].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
      return {
        ...previous,
        virtualDevices: nextVirtualDevices
      };
    });
  }, []);

  const saveAdminVirtualDevice = async () => {
    if (!token || !virtualControlDeviceId || !virtualControlPatch) {
      return;
    }

    const busyId = `admin-virtual-control-${virtualControlDeviceId}`;
    setBusyKey(busyId);
    setErrorMessage(null);

    try {
      const updated = await api.adminVirtualDeviceControl(token, virtualControlDeviceId, virtualControlPatch);
      applyUpdatedVirtualDevice(updated);
      const nextPatch = patchFromVirtualDevice(updated);
      setVirtualControlPatch((previous) => (sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const closeCounterResetModal = useCallback(() => {
    setCounterResetTarget(null);
  }, []);

  const openCounterResetModal = useCallback((deviceId: string, isVirtual = false) => {
    setCounterResetTarget({ deviceId, isVirtual });
  }, []);

  const confirmCounterReset = async () => {
    if (!counterResetTarget) {
      return;
    }
    if (counterResetTarget.isVirtual) {
      if (!token) {
        return;
      }
      const busyId = `admin-virtual-counter-reset-${counterResetTarget.deviceId}`;
      setBusyKey(busyId);
      setErrorMessage(null);
      try {
        const updated = await api.adminVirtualDeviceControl(token, counterResetTarget.deviceId, {
          counterValue: 0
        });
        applyUpdatedVirtualDevice(updated);
        if (virtualControlDeviceId === updated.deviceId) {
          const nextPatch = patchFromVirtualDevice(updated);
          setVirtualControlPatch((previous) => (sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch));
        }
        closeCounterResetModal();
      } catch (error) {
        setErrorMessage(toErrorMessage(error));
      } finally {
        setBusyKey(null);
      }
      return;
    }

    const ok = await sendAdminDeviceCommand(counterResetTarget.deviceId, 'COUNTER_RESET');
    if (ok) {
      closeCounterResetModal();
    }
  };

  const closePinEditor = useCallback(() => {
    setPinEditorDeviceId(null);
    setPinEditorValue('');
    setPinEditorLoading(false);
  }, []);

  const openPinEditor = useCallback(async (deviceId: string) => {
    if (!token) {
      return;
    }

    setPinEditorDeviceId(deviceId);
    setPinEditorValue('');
    setPinEditorLoading(true);
    setErrorMessage(null);

    try {
      const pinInfo = await api.adminDevicePin(token, deviceId);
      setPinEditorValue(pinInfo.pin);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
      setPinEditorDeviceId(null);
    } finally {
      setPinEditorLoading(false);
    }
  }, [token]);

  const savePinEditor = async () => {
    if (!token || !pinEditorDeviceId) {
      return;
    }
    const nextPin = pinEditorValue.trim();
    if (!nextPin) {
      setErrorMessage(t('pinBlankError'));
      return;
    }

    setBusyKey(`pin-save-${pinEditorDeviceId}`);
    setErrorMessage(null);

    try {
      const updated = await api.updateAdminDevicePin(token, pinEditorDeviceId, nextPin);
      setPinEditorValue(updated.pin);
      setInfoMessage(t('pinSaved'));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const setMqttDraftField = useCallback(<K extends keyof MqttEventDraft>(key: K, value: MqttEventDraft[K]) => {
    setMqttEventDraft((previous) => {
      if (previous[key] === value) {
        return previous;
      }
      return {
        ...previous,
        [key]: value
      };
    });
  }, []);

  const setMqttTargetType = useCallback((targetType: MqttComposerTargetType) => {
    setMqttEventDraft((previous) => {
      if (previous.targetType === targetType) {
        return previous;
      }
      const nextTemplate = normalizeMqttTemplateForTarget(targetType, previous.template);
      const nextDeviceId = resolveMqttDeviceId(
        targetType,
        previous.deviceId,
        adminPhysicalDeviceIds,
        adminVirtualDeviceIds
      );
      return {
        ...previous,
        targetType,
        template: nextTemplate,
        deviceId: nextDeviceId
      };
    });
  }, [adminPhysicalDeviceIds, adminVirtualDeviceIds]);

  const setMqttTemplate = useCallback((template: MqttComposerTemplate) => {
    setMqttEventDraft((previous) => {
      const nextTemplate = normalizeMqttTemplateForTarget(previous.targetType, template);
      if (previous.template === nextTemplate) {
        return previous;
      }
      return {
        ...previous,
        template: nextTemplate
      };
    });
  }, []);

  const setMqttDeviceId = useCallback((deviceId: string) => {
    setMqttEventDraft((previous) => {
      if (previous.deviceId === deviceId) {
        return previous;
      }
      return {
        ...previous,
        deviceId
      };
    });
  }, []);

  const openMqttEventModal = useCallback(() => {
    setMqttComposerMode('guided');
    setMqttEventDraft((previous) => {
      let nextTargetType = previous.targetType;
      if (nextTargetType === 'physical' && adminPhysicalDeviceIds.length === 0) {
        nextTargetType = adminVirtualDeviceIds.length > 0 ? 'virtual' : 'custom';
      }
      if (nextTargetType === 'virtual' && adminVirtualDeviceIds.length === 0) {
        nextTargetType = adminPhysicalDeviceIds.length > 0 ? 'physical' : 'custom';
      }

      const nextTemplate = normalizeMqttTemplateForTarget(nextTargetType, previous.template);
      const nextDeviceId = resolveMqttDeviceId(
        nextTargetType,
        previous.deviceId,
        adminPhysicalDeviceIds,
        adminVirtualDeviceIds
      );

      const nextDraft = {
        ...previous,
        targetType: nextTargetType,
        template: nextTemplate,
        deviceId: nextDeviceId
      };
      const guided = buildGuidedMqttMessage(nextDraft);
      return {
        ...nextDraft,
        rawTopic: guided.topic,
        rawPayload: guided.payload
      };
    });
    setMqttModalOpen(true);
  }, [adminPhysicalDeviceIds, adminVirtualDeviceIds]);

  const closeMqttEventModal = useCallback(() => {
    setMqttModalOpen(false);
  }, []);

  const setMqttComposerModeWithSync = useCallback((mode: MqttComposerMode) => {
    setMqttComposerMode(mode);
    if (mode !== 'raw') {
      return;
    }
    setMqttEventDraft((previous) => ({
      ...previous,
      rawTopic: guidedMqttMessage.topic,
      rawPayload: guidedMqttMessage.payload
    }));
  }, [guidedMqttMessage.payload, guidedMqttMessage.topic]);

  const sendAdminMqttEvent = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }

    const topic = (mqttComposerMode === 'raw' ? mqttEventDraft.rawTopic : guidedMqttMessage.topic).trim();
    const payload = (mqttComposerMode === 'raw' ? mqttEventDraft.rawPayload : guidedMqttMessage.payload).trim();

    if (!topic) {
      setErrorMessage(t('mqttTopicRequired'));
      return;
    }
    if (!payload) {
      setErrorMessage(t('mqttPayloadRequired'));
      return;
    }
    const payloadLooksLikeJsonLiteral =
      payload.startsWith('{') ||
      payload.startsWith('[') ||
      payload.startsWith('"') ||
      payload === 'true' ||
      payload === 'false' ||
      payload === 'null' ||
      /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(payload);
    if (payloadLooksLikeJsonLiteral) {
      try {
        JSON.parse(payload);
      } catch {
        setErrorMessage(t('mqttPayloadInvalidJson'));
        return;
      }
    }

    setBusyKey('admin-mqtt-publish');
    setErrorMessage(null);

    try {
      await api.adminPublishMqttEvent(token, topic, payload, mqttEventDraft.qos, mqttEventDraft.retained);
      setMqttModalOpen(false);
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
      const [tasks, devices, virtualDevices, groups, events, settings, systemStatus] = await Promise.all([
        api.adminTasks(token),
        api.adminDevices(token),
        api.adminVirtualDevices(token),
        api.adminGroups(token),
        api.eventsFeed(token, { limit: MAX_FEED_EVENTS, includeInternal: true }),
        api.adminSettings(token),
        api.adminSystemStatus(token)
      ]);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          tasks,
          devices,
          virtualDevices,
          groups,
          events: clampFeed(events),
          settings
        };
      });
      deferredAdminFeedRef.current = [];
      setAdminSettingsDraftMode(settings.defaultLanguageMode);
      setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
      setAdminSettingsDraftVirtualVisible(settings.studentVirtualDeviceVisible);
      setDefaultLanguageMode(settings.defaultLanguageMode);
      setTimeFormat24h(settings.timeFormat24h);
      setAdminSystemStatus((previous) => (sameAdminSystemStatus(previous, systemStatus) ? previous : systemStatus));
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const resetStoredEvents = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }

    setBusyKey('admin-reset-events');
    setErrorMessage(null);

    try {
      const reset = await api.adminResetEvents(token);
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          events: []
        };
      });
      deferredAdminFeedRef.current = [];
      clearRecentFeedHighlights();
      setResetEventsModalOpen(false);

      const latestStatus = await api.adminSystemStatus(token);
      setAdminSystemStatus((previous) => (sameAdminSystemStatus(previous, latestStatus) ? previous : latestStatus));
      setInfoMessage(`${t('resetStoredEventsDone')}: ${reset.deletedEvents}`);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const toggleSystemDataExportPart = useCallback((part: SystemDataPart, checked: boolean) => {
    setSystemDataExportSelection((previous) => {
      if (previous[part] === checked) {
        return previous;
      }
      return {
        ...previous,
        [part]: checked
      };
    });
  }, []);

  const toggleSystemDataImportPart = useCallback((part: SystemDataPart, checked: boolean) => {
    setSystemDataImportSelection((previous) => {
      if (previous[part] === checked) {
        return previous;
      }
      return {
        ...previous,
        [part]: checked
      };
    });
  }, []);

  const handleSystemImportFileSelected = useCallback((file: File) => {
    setSystemDataImportFileName(file.name);
    setSystemDataImportFile(file);
    setSystemDataImportVerify(null);
    setSystemDataImportSelection(createSystemDataPartSelection(false));
    setInfoMessage(null);
    setErrorMessage(null);
  }, []);

  const exportSystemData = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    if (selectedSystemDataExportParts.length === 0) {
      setErrorMessage(t('systemDataSelectAtLeastOne'));
      return;
    }

    setBusyKey('admin-system-export');
    setErrorMessage(null);

    try {
      const blob = await api.adminExportSystemData(token, selectedSystemDataExportParts);
      const safeStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `epl-export-${safeStamp}.zip`;
      const objectUrl = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      window.document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const verifySystemImport = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    if (!systemDataImportFile) {
      setErrorMessage(t('systemDataImportNoFile'));
      return;
    }

    setBusyKey('admin-system-import-verify');
    setErrorMessage(null);

    try {
      const verified = await api.adminVerifySystemDataImport(token, systemDataImportFile);
      setSystemDataImportVerify(verified);

      const selected = createSystemDataPartSelection(false);
      for (const entry of verified.availableParts) {
        selected[entry.part] = true;
      }
      setSystemDataImportSelection(selected);

      if (verified.valid) {
        setInfoMessage(t('systemDataImportValid'));
      } else {
        setErrorMessage(verified.errors.join(' | ') || t('systemDataImportInvalid'));
      }
    } catch (error) {
      setSystemDataImportVerify(null);
      setSystemDataImportSelection(createSystemDataPartSelection(false));
      setErrorMessage(toErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  const applySystemImport = async () => {
    if (!token || !session || session.role !== 'ADMIN') {
      return;
    }
    if (!systemDataImportFile || !systemDataImportVerify || !systemDataImportVerify.valid) {
      setErrorMessage(t('systemDataImportInvalid'));
      return;
    }
    if (selectedSystemDataImportParts.length === 0) {
      setErrorMessage(t('systemDataSelectAtLeastOne'));
      return;
    }
    if (!window.confirm(t('systemDataImportConfirm'))) {
      return;
    }

    setBusyKey('admin-system-import-apply');
    setErrorMessage(null);

    try {
      const imported = await api.adminApplySystemDataImport(
        token,
        systemDataImportFile,
        selectedSystemDataImportParts
      );
      const summary = imported.importedParts
        .map((entry) => `${systemDataPartLabel(entry.part, t)} (${entry.rowCount})`)
        .join(', ');
      setInfoMessage(`${t('systemDataImportDone')}: ${summary}`);
      await refreshAdminData();
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
      if (!studentShowInternal && (event.isInternal || isTelemetryEvent(event))) {
        return false;
      }
      return feedMatchesTopic(event, studentTopicFilter);
    });
  }, [studentData, studentShowInternal, studentTopicFilter]);

  const adminVisibleFeed = useMemo(() => {
    if (!adminData || session?.role !== 'ADMIN' || adminPage !== 'feed') {
      return [];
    }

    return adminData.events.filter((event) => {
      if (!adminIncludeInternal && (event.isInternal || isTelemetryEvent(event))) {
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
  }, [adminCategoryFilter, adminData, adminDeviceFilter, adminIncludeInternal, adminPage, adminTopicFilter, session?.role]);

  const studentFeedValues = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of studentVisibleFeed) {
      values.set(event.id, eventValueSummary(event));
    }
    return values;
  }, [studentVisibleFeed]);

  const adminFeedValues = useMemo(() => {
    const values = new Map<string, string>();
    for (const event of adminVisibleFeed) {
      values.set(event.id, eventValueSummary(event));
    }
    return values;
  }, [adminVisibleFeed]);

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

  const userMenuLabel = useMemo(() => {
    if (!session) {
      return '';
    }
    return session.displayName?.trim() || session.username;
  }, [session]);

  const adminOnlineDeviceCount = useMemo(() => {
    if (!adminData) {
      return 0;
    }
    return adminData.devices.reduce((sum, device) => sum + (device.online ? 1 : 0), 0);
  }, [adminData]);

  const adminOnlineUserCount = useMemo(() => {
    if (!adminData) {
      return 0;
    }
    return adminData.groups.reduce((sum, group) => sum + group.onlineCount, 0);
  }, [adminData]);

  const adminActiveTask = useMemo(() => {
    if (!adminData) {
      return null;
    }
    return adminData.tasks.find((task) => task.active) ?? null;
  }, [adminData]);

  const adminLatestEvent = useMemo(() => {
    if (!adminData || adminData.events.length === 0) {
      return null;
    }
    return adminData.events[0];
  }, [adminData]);

  const systemStatusSeries = useMemo(() => {
    return adminSystemStatus?.eventsLast10Minutes ?? [];
  }, [adminSystemStatus]);

  const systemStatusMaxEventCount = useMemo(() => {
    if (systemStatusSeries.length === 0) {
      return 1;
    }
    const max = systemStatusSeries.reduce((current, point) => Math.max(current, point.eventCount), 0);
    return Math.max(1, max);
  }, [systemStatusSeries]);

  const systemStatusRamUsagePct = useMemo(() => {
    if (!adminSystemStatus) {
      return null;
    }
    const used = adminSystemStatus.ramUsedBytes;
    const total = adminSystemStatus.ramTotalBytes;
    if (used === null || total === null || total <= 0) {
      return null;
    }
    return Math.max(0, Math.min(100, (used / total) * 100));
  }, [adminSystemStatus]);

  const selectedSystemDataExportParts = useMemo(() => {
    return selectedSystemDataParts(systemDataExportSelection);
  }, [systemDataExportSelection]);

  const availableSystemDataImportParts = useMemo(() => {
    if (!systemDataImportVerify) {
      return [];
    }
    return systemDataImportVerify.availableParts.map((entry) => entry.part);
  }, [systemDataImportVerify]);

  const selectedSystemDataImportParts = useMemo(() => {
    const available = new Set(availableSystemDataImportParts);
    return selectedSystemDataParts(systemDataImportSelection).filter((part) => available.has(part));
  }, [availableSystemDataImportParts, systemDataImportSelection]);

  const counterResetBusy = counterResetTarget
    ? counterResetTarget.isVirtual
      ? busyKey === `admin-virtual-counter-reset-${counterResetTarget.deviceId}`
      : busyKey === `admin-command-${counterResetTarget.deviceId}-COUNTER_RESET-undefined`
    : false;
  const studentVirtualBusy = busyKey === 'student-virtual-control';
  const virtualControlBusy = virtualControlDeviceId
    ? busyKey === `admin-virtual-control-${virtualControlDeviceId}`
    : false;
  const selectedAdminVirtualDevice = useMemo(() => {
    if (!adminData || !virtualControlDeviceId) {
      return null;
    }
    return adminData.virtualDevices.find((entry) => entry.deviceId === virtualControlDeviceId) ?? null;
  }, [adminData, virtualControlDeviceId]);

  const openSettingsSection = useCallback(() => {
    if (session?.role === 'ADMIN') {
      setAdminPage('settings');
      setUserMenuOpen(false);
      return;
    }
    const element = document.getElementById('student-settings-panel');
    if (!element) {
      setUserMenuOpen(false);
      return;
    }
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setUserMenuOpen(false);
  }, [session]);

  const formatTs = useCallback(
    (value: TimestampValue): string => {
      return formatTimestamp(value, language, timeFormat24h);
    },
    [language, timeFormat24h]
  );

  const selectedEventFields = useMemo<Array<[string, string]>>(() => {
    if (!selectedEvent) {
      return [];
    }

    return [
      [t('eventFieldId'), selectedEvent.id],
      [t('eventFieldDeviceId'), selectedEvent.deviceId],
      [t('eventFieldTopic'), selectedEvent.topic],
      [t('eventFieldEventType'), selectedEvent.eventType],
      [t('eventFieldCategory'), selectedEvent.category],
      [t('eventFieldIngestTs'), formatTs(selectedEvent.ingestTs)],
      [t('eventFieldDeviceTs'), formatTs(selectedEvent.deviceTs)],
      [t('eventFieldValue'), eventValueSummary(selectedEvent) || '-'],
      [t('eventFieldValid'), String(selectedEvent.valid)],
      [t('eventFieldValidationErrors'), selectedEvent.validationErrors ?? '-'],
      [t('eventFieldInternal'), String(selectedEvent.isInternal)],
      [t('eventFieldGroupKey'), selectedEvent.groupKey ?? '-'],
      [t('eventFieldSequenceNo'), selectedEvent.sequenceNo == null ? '-' : String(selectedEvent.sequenceNo)],
      [t('eventFieldScenarioFlags'), selectedEvent.scenarioFlags]
    ];
  }, [formatTs, selectedEvent, t]);

  const selectedEventRawJson = useMemo(() => {
    if (!selectedEvent) {
      return '';
    }
    const parsedPayload = tryParsePayload(selectedEvent.payloadJson);
    const payloadForRaw = parsedPayload === null ? selectedEvent.payloadJson : parsedPayload;
    return JSON.stringify(
      {
        ...selectedEvent,
        payloadJson: payloadForRaw,
        payloadJsonRaw: selectedEvent.payloadJson
      },
      null,
      2
    );
  }, [selectedEvent]);

  const selectedEventPayloadPretty = useMemo(() => {
    if (!selectedEvent) {
      return '';
    }
    const parsedPayload = tryParsePayload(selectedEvent.payloadJson);
    return JSON.stringify(parsedPayload ?? selectedEvent.payloadJson, null, 2);
  }, [selectedEvent]);

  const studentFeedRows = useMemo(() => {
    if (studentVisibleFeed.length === 0) {
      return null;
    }
    return studentVisibleFeed.map((eventItem) => (
      <tr
        key={eventItem.id}
        className={`feed-row-clickable ${recentFeedEventIds[eventItem.id] ? 'feed-row-new' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          setSelectedEvent(eventItem);
          setEventDetailsViewMode('rendered');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedEvent(eventItem);
            setEventDetailsViewMode('rendered');
          }
        }}
      >
        <td>{formatTs(eventItem.ingestTs)}</td>
        <td>{eventItem.deviceId}</td>
        <td>{eventItem.eventType}</td>
        <td className="mono raw-cell">
          {feedViewMode === 'rendered'
            ? (studentFeedValues.get(eventItem.id) ?? '')
            : eventItem.payloadJson}
        </td>
        <td className="mono">{eventItem.topic}</td>
      </tr>
    ));
  }, [feedViewMode, formatTs, recentFeedEventIds, studentFeedValues, studentVisibleFeed]);

  const adminDeviceCards = useMemo(() => {
    const adminDevices = adminData?.devices;
    if (!adminDevices) {
      return null;
    }
    return adminDevices.map((device) => {
      const snapshot = adminDeviceSnapshots[device.deviceId];
      const uptimeNow = estimateUptimeNow(snapshot, nowEpochMs);
      const redPressed = snapshot?.buttonRedPressed ?? null;
      const blackPressed = snapshot?.buttonBlackPressed ?? null;
      const greenOn = snapshot?.ledGreenOn ?? null;
      const orangeOn = snapshot?.ledOrangeOn ?? null;
      const temperatureC = snapshot?.temperatureC ?? null;
      const humidityPct = snapshot?.humidityPct ?? null;
      const brightnessRaw = snapshot?.brightness ?? null;
      const counterRaw = snapshot?.counterValue ?? null;
      const isDeviceOnline = device.online;
      const redButton =
        !isDeviceOnline || redPressed === null
          ? t('stateUnknown')
          : redPressed
            ? t('statePressed')
            : t('stateReleased');
      const blackButton =
        !isDeviceOnline || blackPressed === null
          ? t('stateUnknown')
          : blackPressed
            ? t('statePressed')
            : t('stateReleased');
      const temperature =
        !isDeviceOnline || temperatureC === null ? '-' : `${temperatureC.toFixed(1)} °C`;
      const humidity =
        !isDeviceOnline || humidityPct === null ? '-' : `${Math.round(humidityPct)} %`;
      const brightness =
        !isDeviceOnline || brightnessRaw === null ? '-' : formatBrightnessMeasurement(brightnessRaw);
      const counterValue =
        counterRaw === null
          ? '-'
          : Number.isInteger(counterRaw)
            ? String(counterRaw)
            : counterRaw.toFixed(2);
      const ipAddress = adminDeviceIpById[device.deviceId] ?? '-';
      const ipAddressHref = ipAddressToHref(ipAddress);
      const lastEventRelative = formatRelativeFromNow(device.lastSeen, nowEpochMs, language);
      const bars = rssiBars(device.rssi);
      const rssiHint =
        !isDeviceOnline ? '-' : device.rssi === null ? t('rssiNoData') : `${device.rssi} dBm`;
      const uptimeLabel =
        !isDeviceOnline || uptimeNow === null ? '-' : formatRoundedDuration(uptimeNow, language);
      const redButtonClass =
        !isDeviceOnline || redPressed === null
          ? 'state-unknown'
          : redPressed
            ? 'state-pressed'
            : 'state-released';
      const blackButtonClass =
        !isDeviceOnline || blackPressed === null
          ? 'state-unknown'
          : blackPressed
            ? 'state-pressed'
            : 'state-released';
      const nextGreenState = greenOn === null ? true : !greenOn;
      const nextOrangeState = orangeOn === null ? true : !orangeOn;
      const greenBusy =
        busyKey?.startsWith(`admin-command-${device.deviceId}-LED_GREEN-`) ?? false;
      const orangeBusy =
        busyKey?.startsWith(`admin-command-${device.deviceId}-LED_ORANGE-`) ?? false;
      const counterBusy = busyKey === `admin-command-${device.deviceId}-COUNTER_RESET-undefined`;
      const rssiTooltipId = `rssi-tooltip-${device.deviceId}`;

      return (
        <article className="device-card" key={device.deviceId}>
          <header>
            <strong>{device.deviceId}</strong>
            <div className="device-header-actions">
              <button
                className="icon-button"
                type="button"
                title={t('pinSettings')}
                aria-label={`${t('pinSettings')} ${device.deviceId}`}
                onClick={() => openPinEditor(device.deviceId)}
              >
                <SettingsIcon />
              </button>
              <span className={`chip ${device.online ? 'ok' : 'warn'}`}>
                {statusLabel(device.online, language)}
              </span>
            </div>
          </header>

          <p title={formatTs(device.lastSeen)}>
            {t('lastEvent')}: {lastEventRelative}
          </p>
          <p>
            {t('ipAddress')}:{' '}
            {ipAddressHref ? (
              <a
                className="device-link"
                href={ipAddressHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ipAddress}
              </a>
            ) : (
              ipAddress
            )}
          </p>
          <p>
            {t('uptime')}: {uptimeLabel}
          </p>
          <div className="rssi-row">
            <span>{t('rssi')}:</span>
            {isDeviceOnline ? (
              <div className="rssi-tooltip-host">
                <div
                  className={`rssi-bars ${rssiClassName(device.rssi)}`}
                  aria-label={rssiHint}
                  aria-describedby={rssiTooltipId}
                >
                  <span className={`bar ${bars >= 1 ? 'active' : ''}`} />
                  <span className={`bar ${bars >= 2 ? 'active' : ''}`} />
                  <span className={`bar ${bars >= 3 ? 'active' : ''}`} />
                  <span className={`bar ${bars >= 4 ? 'active' : ''}`} />
                </div>
                <span className="rssi-tooltip" id={rssiTooltipId}>
                  {rssiHint}
                </span>
              </div>
            ) : (
              <span className="muted">-</span>
            )}
          </div>
          <div className="device-metrics-grid">
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="temperature" />
              </span>
              <span className="metric-text" title={t('metricTemp')}>{temperature}</span>
            </div>
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="humidity" />
              </span>
              <span className="metric-text" title={t('metricHumidity')}>{humidity}</span>
            </div>
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="brightness" />
              </span>
              <span className="metric-text" title={t('metricBrightness')}>{brightness}</span>
            </div>
            <button
              className="device-metric counter-metric-trigger"
              type="button"
              onClick={() => openCounterResetModal(device.deviceId)}
              title={t('commandCounterReset')}
              disabled={!isDeviceOnline || counterBusy}
            >
              <span className="metric-icon">
                <MetricIcon kind="counter" />
              </span>
              <span className="metric-text">{counterValue}</span>
            </button>
            <div className="device-metric full">
              <span className="metric-icon">
                <MetricIcon kind="buttons" />
              </span>
              <span className="metric-text metric-state-row">
                <span className="metric-label">{t('colorRed')}:</span>
                <span className={`state-label ${redButtonClass}`}>{redButton}</span>
              </span>
            </div>
            <div className="device-metric full">
              <span className="metric-icon">
                <MetricIcon kind="buttons" />
              </span>
              <span className="metric-text metric-state-row">
                <span className="metric-label">{t('colorBlack')}:</span>
                <span className={`state-label ${blackButtonClass}`}>{blackButton}</span>
              </span>
            </div>
          </div>

          <div className="button-grid">
            <button
              className={`button ${greenOn ? 'active' : 'secondary'}`}
              type="button"
              onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_GREEN', nextGreenState)}
              disabled={greenBusy || !isDeviceOnline}
            >
              {t('commandGreenLed')}
            </button>
            <button
              className={`button ${orangeOn ? 'active' : 'secondary'}`}
              type="button"
              onClick={() => sendAdminDeviceCommand(device.deviceId, 'LED_ORANGE', nextOrangeState)}
              disabled={orangeBusy || !isDeviceOnline}
            >
              {t('commandOrangeLed')}
            </button>
          </div>
        </article>
      );
    });
  }, [
    adminData?.devices,
    adminDeviceIpById,
    adminDeviceSnapshots,
    busyKey,
    formatTs,
    language,
    nowEpochMs,
    openCounterResetModal,
    openPinEditor,
    sendAdminDeviceCommand,
    t
  ]);

  const adminVirtualDeviceCards = useMemo(() => {
    const adminVirtualDevices = adminData?.virtualDevices;
    if (!adminVirtualDevices) {
      return null;
    }
    return adminVirtualDevices.map((device) => {
      const redButtonClass = device.buttonRedPressed ? 'state-pressed' : 'state-released';
      const blackButtonClass = device.buttonBlackPressed ? 'state-pressed' : 'state-released';
      const counterBusy = busyKey === `admin-virtual-counter-reset-${device.deviceId}`;

      return (
        <article className="device-card" key={device.deviceId}>
          <header>
            <strong>{device.deviceId}</strong>
            <div className="device-header-actions">
              <button
                className="button tiny secondary"
                type="button"
                onClick={() => openVirtualControlModal(device.deviceId)}
              >
                {t('openControls')}
              </button>
            </div>
          </header>

          <p>{t('groupConfig')}: {device.groupKey}</p>
          <p title={formatTs(device.updatedAt)}>
            {t('lastEvent')}: {formatRelativeFromNow(device.updatedAt, nowEpochMs, language)}
          </p>

          <div className="device-metrics-grid">
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="temperature" />
              </span>
              <span className="metric-text">{device.temperatureC.toFixed(1)} °C</span>
            </div>
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="humidity" />
              </span>
              <span className="metric-text">{Math.round(device.humidityPct)} %</span>
            </div>
            <div className="device-metric">
              <span className="metric-icon">
                <MetricIcon kind="brightness" />
              </span>
              <span className="metric-text">{formatBrightnessMeasurement(device.brightness)}</span>
            </div>
            <button
              className="device-metric counter-metric-trigger"
              type="button"
              onClick={() => openCounterResetModal(device.deviceId, true)}
              title={t('commandCounterReset')}
              disabled={counterBusy}
            >
              <span className="metric-icon">
                <MetricIcon kind="counter" />
              </span>
              <span className="metric-text">{device.counterValue}</span>
            </button>
            <div className="device-metric full">
              <span className="metric-icon">
                <MetricIcon kind="buttons" />
              </span>
              <span className="metric-text metric-state-row">
                <span className="metric-label">{t('colorRed')}:</span>
                <span className={`state-label ${redButtonClass}`}>
                  {device.buttonRedPressed ? t('statePressed') : t('stateReleased')}
                </span>
              </span>
            </div>
            <div className="device-metric full">
              <span className="metric-icon">
                <MetricIcon kind="buttons" />
              </span>
              <span className="metric-text metric-state-row">
                <span className="metric-label">{t('colorBlack')}:</span>
                <span className={`state-label ${blackButtonClass}`}>
                  {device.buttonBlackPressed ? t('statePressed') : t('stateReleased')}
                </span>
              </span>
            </div>
          </div>
        </article>
      );
    });
  }, [
    adminData?.virtualDevices,
    busyKey,
    formatTs,
    language,
    nowEpochMs,
    openCounterResetModal,
    openVirtualControlModal,
    t
  ]);

  const adminFeedRows = useMemo(() => {
    if (adminVisibleFeed.length === 0) {
      return null;
    }
    return adminVisibleFeed.map((eventItem) => (
      <tr
        key={eventItem.id}
        className={`feed-row-clickable ${recentFeedEventIds[eventItem.id] ? 'feed-row-new' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => {
          setSelectedEvent(eventItem);
          setEventDetailsViewMode('rendered');
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedEvent(eventItem);
            setEventDetailsViewMode('rendered');
          }
        }}
      >
        <td>{formatTs(eventItem.ingestTs)}</td>
        <td>{eventItem.deviceId}</td>
        <td>{eventItem.eventType}</td>
        <td className="mono raw-cell">
          {feedViewMode === 'rendered'
            ? (adminFeedValues.get(eventItem.id) ?? '')
            : eventItem.payloadJson}
        </td>
        <td>{eventItem.category}</td>
        <td className="mono">{eventItem.topic}</td>
      </tr>
    ));
  }, [adminFeedValues, adminVisibleFeed, feedViewMode, formatTs, recentFeedEventIds]);

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
          <option value="compact">{t('configOptionCompact')}</option>
          <option value="detailed">{t('configOptionDetailed')}</option>
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
          <option value="all">{t('configOptionAll')}</option>
          <option value="ldr">{t('configOptionLdr')}</option>
          <option value="dht22">{t('configOptionDht22')}</option>
          <option value="buttons">{t('configOptionButtons')}</option>
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
          <span>{t('configEnabled')}</span>
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
      <AppTopBar
        t={t}
        hasSession={!!session}
        userMenuRef={userMenuRef}
        userMenuOpen={userMenuOpen}
        userMenuLabel={userMenuLabel}
        wsConnection={wsConnection}
        wsLabel={wsLabel}
        roleLabel={roleLabel}
        language={language}
        logoutBusy={busyKey === 'logout'}
        onToggleUserMenu={() => setUserMenuOpen((open) => !open)}
        onSetLanguage={setManualLanguage}
        onOpenSettings={openSettingsSection}
        onLogout={handleLogout}
      />

      <main className="content">
        <MainStateBanners
          t={t}
          errorMessage={errorMessage}
          infoMessage={infoMessage}
          booting={booting}
        />

        {!booting && !session ? (
          <LoginSection
            t={t}
            username={loginUsername}
            pin={loginPin}
            busy={busyKey === 'login'}
            onUsernameChange={setLoginUsername}
            onPinChange={setLoginPin}
            onSubmit={() => {
              void handleLogin();
            }}
          />
        ) : null}

        {!booting && session?.role === 'STUDENT' && studentData && !studentOnboardingDone ? (
          <StudentOnboardingSection
            t={t}
            language={language}
            displayNameDraft={displayNameDraft}
            busy={busyKey === 'student-onboarding'}
            onDisplayNameChange={setDisplayNameDraft}
            onSetLanguage={setManualLanguage}
            onSubmit={() => {
              continueStudentOnboarding().catch((error) => setErrorMessage(toErrorMessage(error)));
            }}
          />
        ) : null}

        {!booting && session?.role === 'STUDENT' && studentData && studentOnboardingDone ? (
          <div className="dashboard-grid">
            <StudentOverviewSection
              t={t}
              taskTitle={taskTitle(studentData.activeTask, language)}
              taskDescription={taskDescription(studentData.activeTask, language)}
              defaultLanguageMode={defaultLanguageMode}
              displayNameDraft={displayNameDraft}
              busy={busyKey === 'display-name'}
              onDisplayNameChange={setDisplayNameDraft}
              onSaveDisplayName={saveDisplayName}
            />

            <StudentGroupConfigSection
              t={t}
              allowedConfigOptions={studentData.capabilities.allowedConfigOptions}
              configDraft={studentConfigDraft}
              revision={studentData.groupConfig.revision}
              updatedBy={studentData.groupConfig.updatedBy}
              updatedAt={studentData.groupConfig.updatedAt}
              busy={busyKey === 'student-config'}
              onConfigOptionChange={(option, nextValue) => {
                setStudentConfigDraft((previous) => ({
                  ...previous,
                  [option]: nextValue
                }));
              }}
              onSave={saveStudentConfig}
              renderConfigInput={renderConfigInput}
              formatTs={formatTs}
            />

            <PipelineBuilderSection
              t={t}
              title={t('pipelineBuilder')}
              view={studentPipeline}
              draftProcessing={studentPipelineDraft}
              onChangeSlotBlock={changeStudentPipelineSlot}
              onSave={saveStudentPipeline}
              saveBusy={busyKey === 'student-pipeline'}
            />

            <StudentPresenceSection
              t={t}
              groupPresence={studentData.groupPresence}
              formatTs={formatTs}
            />

            <StudentCapabilitiesSection
              t={t}
              capabilities={studentData.capabilities}
            />

            {studentData.capabilities.canSendDeviceCommands ? (
              <StudentCommandsSection
                t={t}
                studentCommandWhitelist={studentData.capabilities.studentCommandWhitelist}
                busyKey={busyKey}
                onSendCommand={sendStudentCommand}
              />
            ) : null}

            {studentData.settings.studentVirtualDeviceVisible && studentData.virtualDevice && studentVirtualPatch ? (
              <StudentVirtualDeviceSection
                t={t}
                deviceId={studentData.virtualDevice.deviceId}
                patch={studentVirtualPatch}
                busy={studentVirtualBusy}
                onSetField={setStudentVirtualField}
                onSave={saveStudentVirtualDevice}
              />
            ) : null}

            <StudentFeedSection
              t={t}
              studentFeedPaused={studentFeedPaused}
              feedViewMode={feedViewMode}
              onTogglePause={() => setStudentFeedPaused((value) => !value)}
              onToggleFeedViewMode={() =>
                setFeedViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
              }
              onClearFeed={() => {
                setStudentData((previous) => {
                  if (!previous) {
                    return previous;
                  }
                  return { ...previous, feed: [] };
                });
              }}
              studentTopicFilter={studentTopicFilter}
              onStudentTopicFilterChange={setStudentTopicFilter}
              canFilterByTopic={studentData.capabilities.canFilterByTopic}
              showInternalEventsToggle={studentData.capabilities.showInternalEventsToggle}
              studentShowInternal={studentShowInternal}
              onStudentShowInternalChange={setStudentShowInternal}
              studentVisibleFeedCount={studentVisibleFeed.length}
              studentFeedRows={studentFeedRows}
            />
          </div>
        ) : null}

        {!booting && session?.role === 'ADMIN' && adminData ? (
          <div className="admin-page-shell">
            <AdminPageNav t={t} adminPage={adminPage} onChangePage={setAdminPage} />

            <div className="dashboard-grid">
              {adminPage === 'dashboard' ? (
                <AdminDashboardSection
                  t={t}
                  wsConnection={wsConnection}
                  wsLabel={wsLabel}
                  deviceCount={adminData.devices.length}
                  onlineDeviceCount={adminOnlineDeviceCount}
                  groupCount={adminData.groups.length}
                  onlineUserCount={adminOnlineUserCount}
                  eventCount={adminData.events.length}
                  currentTaskLabel={adminActiveTask ? taskTitle(adminActiveTask, language) : '-'}
                  lastEventLabel={
                    adminLatestEvent
                      ? formatRelativeFromNow(adminLatestEvent.ingestTs, nowEpochMs, language)
                      : '-'
                  }
                  onNavigate={setAdminPage}
                />
              ) : null}

              {adminPage === 'settings' ? (
                <AdminSettingsSection
                  t={t}
                  mode={adminSettingsDraftMode}
                  timeFormat24h={adminSettingsDraftTimeFormat24h}
                  studentVirtualDeviceVisible={adminSettingsDraftVirtualVisible}
                  busy={busyKey === 'admin-settings'}
                  onModeChange={setAdminSettingsDraftMode}
                  onTimeFormat24hChange={setAdminSettingsDraftTimeFormat24h}
                  onStudentVirtualDeviceVisibleChange={setAdminSettingsDraftVirtualVisible}
                  onSave={saveAdminSettings}
                />
              ) : null}

              {adminPage === 'systemStatus' ? (
                <SystemStatusSection
                  t={t}
                  language={language}
                  timeFormat24h={timeFormat24h}
                  busyKey={busyKey}
                  adminSystemStatus={adminSystemStatus}
                  systemStatusSeries={systemStatusSeries}
                  systemStatusMaxEventCount={systemStatusMaxEventCount}
                  systemStatusRamUsagePct={systemStatusRamUsagePct}
                  formatTs={formatTs}
                  refreshAdminData={refreshAdminData}
                  onOpenResetEventsModal={() => setResetEventsModalOpen(true)}
                  systemDataExportSelection={systemDataExportSelection}
                  onToggleSystemDataExportPart={toggleSystemDataExportPart}
                  onExportSystemData={exportSystemData}
                  selectedSystemDataExportPartsCount={selectedSystemDataExportParts.length}
                  systemDataImportFileName={systemDataImportFileName}
                  onSystemImportFileSelected={handleSystemImportFileSelected}
                  onVerifySystemImport={verifySystemImport}
                  onApplySystemImport={applySystemImport}
                  systemDataImportFilePresent={!!systemDataImportFile}
                  systemDataImportVerify={systemDataImportVerify}
                  systemDataImportSelection={systemDataImportSelection}
                  onToggleSystemDataImportPart={toggleSystemDataImportPart}
                  selectedSystemDataImportPartsCount={selectedSystemDataImportParts.length}
                />
              ) : null}

              {adminPage === 'groupsTasks' ? (
                <AdminGroupsTasksSection
                  t={t}
                  tasks={adminData.tasks}
                  groups={adminData.groups}
                  taskLabel={(task) => taskTitle(task, language)}
                  taskDescriptionLabel={(task) => taskDescription(task, language)}
                  onActivateTask={activateTask}
                  isTaskActivationBusy={(taskId) => busyKey === `activate-${taskId}`}
                  formatTs={formatTs}
                />
              ) : null}

              {adminPage === 'pipeline' ? (
                <>
                  <PipelineTaskConfigSection
                    t={t}
                    tasks={adminData.tasks}
                    selectedTaskId={adminPipelineTaskId}
                    taskLabel={(task) => taskTitle(task, language)}
                    config={adminTaskPipelineConfigDraft ?? adminTaskPipelineConfig}
                    busy={
                      busyKey === 'admin-task-pipeline-config' ||
                      busyKey === 'admin-task-pipeline-config-load'
                    }
                    onSelectTask={selectAdminPipelineTask}
                    onToggleVisibleToStudents={changeTaskPipelineVisibleToStudents}
                    onSlotCountChange={changeTaskPipelineSlotCount}
                    onToggleAllowedBlock={toggleTaskPipelineAllowedBlock}
                    onSave={saveAdminTaskPipelineConfig}
                    formatTs={formatTs}
                  />

                  <PipelineBuilderSection
                    t={t}
                    title={t('pipelineBuilder')}
                    view={adminPipelineDraft ?? adminPipeline}
                    groupOptions={adminData.groups.map((group) => group.groupKey)}
                    selectedGroupKey={adminPipelineGroupKey}
                    onSelectGroup={selectAdminPipelineGroup}
                    draftProcessing={adminPipelineDraft?.processing ?? adminPipeline?.processing ?? null}
                    onChangeSlotBlock={changeAdminPipelineSlot}
                    onInputModeChange={changeAdminPipelineInputMode}
                    onDeviceScopeChange={changeAdminPipelineDeviceScope}
                    onIngestFiltersChange={changeAdminPipelineIngestFilters}
                    onScenarioOverlaysChange={changeAdminPipelineScenarioOverlays}
                    onSinkTargetsChange={changeAdminPipelineSinkTargets}
                    onSinkGoalChange={changeAdminPipelineSinkGoal}
                    onSave={saveAdminPipeline}
                    saveBusy={busyKey === 'admin-pipeline' || busyKey === 'admin-pipeline-load'}
                  />

                  <PipelineCompareSection
                    t={t}
                    rows={adminPipelineCompareRows}
                    formatTs={formatTs}
                  />
                </>
              ) : null}

              {adminPage === 'devices' ? (
                <AdminDevicesSection
                  title={t('devices')}
                  refreshLabel={t('refresh')}
                  busy={busyKey === 'admin-refresh'}
                  onRefresh={refreshAdminData}
                  cards={adminDeviceCards}
                />
              ) : null}

              {adminPage === 'virtualDevices' ? (
                <AdminDevicesSection
                  title={t('virtualDevices')}
                  refreshLabel={t('refresh')}
                  busy={busyKey === 'admin-refresh'}
                  onRefresh={refreshAdminData}
                  cards={adminVirtualDeviceCards}
                />
              ) : null}

              {adminPage === 'feed' ? (
                <AdminFeedSection
                  t={t}
                  adminFeedPaused={adminFeedPaused}
                  feedViewMode={feedViewMode}
                  onTogglePause={() => setAdminFeedPaused((value) => !value)}
                  onToggleFeedViewMode={() =>
                    setFeedViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
                  }
                  onClearFeed={() => {
                    setAdminData((previous) => {
                      if (!previous) {
                        return previous;
                      }
                      return { ...previous, events: [] };
                    });
                  }}
                  onOpenSendEventModal={openMqttEventModal}
                  adminTopicFilter={adminTopicFilter}
                  onAdminTopicFilterChange={setAdminTopicFilter}
                  adminDeviceFilter={adminDeviceFilter}
                  onAdminDeviceFilterChange={setAdminDeviceFilter}
                  adminCategoryFilter={adminCategoryFilter}
                  onAdminCategoryFilterChange={setAdminCategoryFilter}
                  categoryOptions={CATEGORY_OPTIONS}
                  adminIncludeInternal={adminIncludeInternal}
                  onAdminIncludeInternalChange={setAdminIncludeInternal}
                  adminVisibleFeedCount={adminVisibleFeed.length}
                  adminFeedRows={adminFeedRows}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </main>

      <AdminMqttEventModal
        t={t}
        open={mqttModalOpen}
        busy={busyKey === 'admin-mqtt-publish'}
        mode={mqttComposerMode}
        draft={mqttEventDraft}
        physicalDeviceIds={adminPhysicalDeviceIds}
        virtualDeviceIds={adminVirtualDeviceIds}
        guidedTopic={guidedMqttMessage.topic}
        guidedPayload={guidedMqttMessage.payload}
        onClose={closeMqttEventModal}
        onSubmit={sendAdminMqttEvent}
        onModeChange={setMqttComposerModeWithSync}
        onTargetTypeChange={setMqttTargetType}
        onTemplateChange={setMqttTemplate}
        onDeviceIdChange={setMqttDeviceId}
        onDraftChange={setMqttDraftField}
      />

      <AppModals
        t={t}
        selectedEvent={selectedEvent}
        selectedEventFields={selectedEventFields}
        selectedEventRawJson={selectedEventRawJson}
        selectedEventPayloadPretty={selectedEventPayloadPretty}
        eventDetailsViewMode={eventDetailsViewMode}
        onToggleEventDetailsViewMode={() =>
          setEventDetailsViewMode((mode) => (mode === 'rendered' ? 'raw' : 'rendered'))
        }
        onCloseSelectedEvent={() => setSelectedEvent(null)}
        virtualControlDeviceId={virtualControlDeviceId}
        selectedAdminVirtualDevice={selectedAdminVirtualDevice}
        virtualControlPatch={virtualControlPatch}
        onCloseVirtualControlModal={closeVirtualControlModal}
        onSetModalVirtualField={setModalVirtualField}
        onSaveAdminVirtualDevice={saveAdminVirtualDevice}
        virtualControlBusy={virtualControlBusy}
        resetEventsModalOpen={resetEventsModalOpen}
        onCloseResetEventsModal={() => setResetEventsModalOpen(false)}
        onResetStoredEvents={resetStoredEvents}
        resetEventsBusy={busyKey === 'admin-reset-events'}
        counterResetTarget={counterResetTarget}
        onCloseCounterResetModal={closeCounterResetModal}
        onConfirmCounterReset={confirmCounterReset}
        counterResetBusy={counterResetBusy}
        pinEditorDeviceId={pinEditorDeviceId}
        pinEditorValue={pinEditorValue}
        onPinEditorValueChange={setPinEditorValue}
        pinEditorLoading={pinEditorLoading}
        pinEditorSaveBusy={pinEditorDeviceId ? busyKey === `pin-save-${pinEditorDeviceId}` : false}
        onSavePinEditor={savePinEditor}
        onClosePinEditor={closePinEditor}
      />
    </div>
  );
}
