import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { api } from '../api';
import {
  MAX_FEED_EVENTS,
  buildDeviceTelemetrySnapshots,
  extractIpAddressesFromEvents,
  extractTaskInfo,
  isAdminFeedHotPage,
  isVirtualDeviceId,
  mergeEventsBounded,
  mergeIpAddressCache,
  mergeTelemetrySnapshotCache,
  patchFromVirtualDevice,
  safeConfigMap,
  sameAppSettings,
  sameDeviceStatus,
  sameGroupConfigMeta,
  samePresenceList,
  sameTaskCapabilities,
  sameTaskInfo,
  sameVirtualDevicePatch,
  sameVirtualDeviceState,
  toErrorMessage
} from '../app/shared';
import { dispatchWsEnvelope, parseWsEnvelope, type WsDispatchHandlers } from '../app/ws-dispatcher';
import type {
  AdminPage,
  AdminViewData,
  DeviceTelemetrySnapshot,
  StudentViewData,
  VirtualDevicePatch,
  WsConnectionState
} from '../app/shared-types';
import type {
  AuthMe,
  CanonicalEvent,
  DeviceStatus,
  FeedScenarioConfig,
  LanguageMode,
  PipelineObservabilityUpdate,
  PipelineSinkRuntimeUpdate,
  PipelineView,
  PresenceUser,
  TaskDefinitionPayload,
  TaskInfo,
  VirtualDeviceTopicMode,
  WsEnvelope
} from '../types';

interface UseRealtimeSyncParams {
  session: AuthMe | null;
  token: string | null;
  studentPauseRef: MutableRefObject<boolean>;
  adminPauseRef: MutableRefObject<boolean>;
  adminDataRef: MutableRefObject<AdminViewData | null>;
  adminPageRef: MutableRefObject<AdminPage>;
  reportBackgroundError: (context: string, error: unknown) => void;
  refreshAdminGroups: (activeToken: string) => Promise<void>;
  refreshAdminTasks: (activeToken: string) => Promise<void>;
  markFeedEventsRecent: (events: CanonicalEvent[]) => void;
  queueDeferredAdminFeedEvents: (events: CanonicalEvent[]) => void;
  flushDeferredAdminFeedEvents: (highlight: boolean) => void;
  setWsConnection: Dispatch<SetStateAction<WsConnectionState>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setStudentData: Dispatch<SetStateAction<StudentViewData | null>>;
  setStudentPipelineFeed: Dispatch<SetStateAction<CanonicalEvent[]>>;
  setStudentConfigDraft: Dispatch<SetStateAction<Record<string, unknown>>>;
  setStudentVirtualPatch: Dispatch<SetStateAction<VirtualDevicePatch | null>>;
  setAdminData: Dispatch<SetStateAction<AdminViewData | null>>;
  setAdminPipelineFeed: Dispatch<SetStateAction<CanonicalEvent[]>>;
  setAdminDeviceSnapshots: Dispatch<SetStateAction<Record<string, DeviceTelemetrySnapshot>>>;
  setAdminDeviceIpById: Dispatch<SetStateAction<Record<string, string>>>;
  setAdminSettingsDraftMode: Dispatch<SetStateAction<LanguageMode>>;
  setAdminSettingsDraftTimeFormat24h: Dispatch<SetStateAction<boolean>>;
  setAdminSettingsDraftVirtualVisible: Dispatch<SetStateAction<boolean>>;
  setAdminSettingsDraftAdminDeviceId: Dispatch<SetStateAction<string | null>>;
  setAdminSettingsDraftVirtualDeviceTopicMode: Dispatch<SetStateAction<VirtualDeviceTopicMode>>;
  setDefaultLanguageMode: Dispatch<SetStateAction<LanguageMode>>;
  setTimeFormat24h: Dispatch<SetStateAction<boolean>>;
  setFeedScenarioConfig: Dispatch<SetStateAction<FeedScenarioConfig | null>>;
  selectedAdminPipelineGroupKeyRef: MutableRefObject<string>;
  onStudentPipelineUpdated: (view: PipelineView) => void;
  onStudentPipelineObservabilityUpdated: (update: PipelineObservabilityUpdate) => void;
  onStudentPipelineSinkRuntimeUpdated: (update: PipelineSinkRuntimeUpdate) => void;
  onAdminPipelineUpdated: (view: PipelineView) => void;
  onAdminPipelineObservabilityUpdated: (update: PipelineObservabilityUpdate, selectedGroupKey: string) => void;
  onAdminPipelineSinkRuntimeUpdated: (
    update: PipelineSinkRuntimeUpdate,
    selectedGroupKey: string
  ) => void;
  onAdminPipelineObserved: (view: PipelineView, selectedGroupKey: string) => void;
}

export function useRealtimeSync({
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
  setStudentPipelineFeed,
  setStudentConfigDraft,
  setStudentVirtualPatch,
  setAdminData,
  setAdminPipelineFeed,
  setAdminDeviceSnapshots,
  setAdminDeviceIpById,
  setAdminSettingsDraftMode,
  setAdminSettingsDraftTimeFormat24h,
  setAdminSettingsDraftVirtualVisible,
  setAdminSettingsDraftAdminDeviceId,
  setAdminSettingsDraftVirtualDeviceTopicMode,
  setDefaultLanguageMode,
  setTimeFormat24h,
  setFeedScenarioConfig,
  selectedAdminPipelineGroupKeyRef,
  onStudentPipelineUpdated,
  onStudentPipelineObservabilityUpdated,
  onStudentPipelineSinkRuntimeUpdated,
  onAdminPipelineUpdated,
  onAdminPipelineObservabilityUpdated,
  onAdminPipelineSinkRuntimeUpdated,
  onAdminPipelineObserved
}: UseRealtimeSyncParams): void {
  useEffect(() => {
    if (!session || !token) {
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let groupRefreshTimer: number | null = null;
    let studentFeedFlushTimer: number | null = null;
    let studentPipelineFeedFlushTimer: number | null = null;
    let adminFeedFlushTimer: number | null = null;
    let adminPipelineFeedFlushTimer: number | null = null;
    let adminDeviceStatusFlushTimer: number | null = null;
    let studentFeedQueue: CanonicalEvent[] = [];
    let studentPipelineFeedQueue: CanonicalEvent[] = [];
    let adminFeedQueue: CanonicalEvent[] = [];
    let adminPipelineFeedQueue: CanonicalEvent[] = [];
    const adminDeviceStatusQueue = new Map<string, DeviceStatus>();
    let closed = false;

    const rolePath = session.role === 'ADMIN' ? '/ws/admin' : '/ws/student';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    const scheduleGroupRefresh = () => {
      if (groupRefreshTimer !== null) {
        return;
      }
      groupRefreshTimer = window.setTimeout(() => {
        groupRefreshTimer = null;
        refreshAdminGroups(token).catch((error) => reportBackgroundError('refreshAdminGroups', error));
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

    const flushStudentFeedQueue = () => {
      studentFeedFlushTimer = null;
      if (studentFeedQueue.length === 0) {
        return;
      }
      const queued = studentFeedQueue;
      studentFeedQueue = [];
      markFeedEventsRecent(queued);
      setStudentData((previous) => {
        if (!previous) {
          return previous;
        }
        const nextFeed = mergeEventsBounded(previous.feed, queued, MAX_FEED_EVENTS);
        if (nextFeed === previous.feed) {
          return previous;
        }
        return {
          ...previous,
          feed: nextFeed
        };
      });
    };

    const queueStudentFeedEvent = (eventPayload: CanonicalEvent) => {
      studentFeedQueue.push(eventPayload);
      if (studentFeedFlushTimer !== null) {
        return;
      }
      studentFeedFlushTimer = window.setTimeout(flushStudentFeedQueue, 180);
    };

    const flushStudentPipelineFeedQueue = () => {
      studentPipelineFeedFlushTimer = null;
      if (studentPipelineFeedQueue.length === 0) {
        return;
      }
      const queued = studentPipelineFeedQueue;
      studentPipelineFeedQueue = [];
      setStudentPipelineFeed((previous) => mergeEventsBounded(previous, queued, MAX_FEED_EVENTS));
    };

    const queueStudentPipelineFeedEvent = (eventPayload: CanonicalEvent) => {
      studentPipelineFeedQueue.push(eventPayload);
      if (studentPipelineFeedFlushTimer !== null) {
        return;
      }
      studentPipelineFeedFlushTimer = window.setTimeout(flushStudentPipelineFeedQueue, 180);
    };

    const flushAdminFeedQueue = () => {
      adminFeedFlushTimer = null;
      if (adminFeedQueue.length === 0) {
        return;
      }
      const queued = adminFeedQueue;
      adminFeedQueue = [];

      queueDeferredAdminFeedEvents(queued);

      const currentPage = adminPageRef.current;
      if (currentPage === 'devices') {
        const latestSnapshots = buildDeviceTelemetrySnapshots(queued);
        if (Object.keys(latestSnapshots).length > 0) {
          setAdminDeviceSnapshots((previous) =>
            mergeTelemetrySnapshotCache(previous, latestSnapshots)
          );
        }

        const latestIpByDeviceId = extractIpAddressesFromEvents(queued);
        if (Object.keys(latestIpByDeviceId).length > 0) {
          setAdminDeviceIpById((previous) => {
            const activeDeviceIds =
              adminDataRef.current?.devices.map((device) => device.deviceId) ??
              Array.from(new Set([...Object.keys(previous), ...Object.keys(latestIpByDeviceId)]));
            return mergeIpAddressCache(previous, latestIpByDeviceId, activeDeviceIds);
          });
        }
      }

      if (isAdminFeedHotPage(currentPage)) {
        flushDeferredAdminFeedEvents(currentPage === 'feed');
      }
    };

    const queueAdminFeedEvent = (eventPayload: CanonicalEvent) => {
      adminFeedQueue.push(eventPayload);
      if (adminFeedFlushTimer !== null) {
        return;
      }
      adminFeedFlushTimer = window.setTimeout(flushAdminFeedQueue, 180);
    };

    const flushAdminPipelineFeedQueue = () => {
      adminPipelineFeedFlushTimer = null;
      if (adminPipelineFeedQueue.length === 0) {
        return;
      }
      const queued = adminPipelineFeedQueue;
      adminPipelineFeedQueue = [];
      setAdminPipelineFeed((previous) => mergeEventsBounded(previous, queued, MAX_FEED_EVENTS));
    };

    const queueAdminPipelineFeedEvent = (eventPayload: CanonicalEvent) => {
      adminPipelineFeedQueue.push(eventPayload);
      if (adminPipelineFeedFlushTimer !== null) {
        return;
      }
      adminPipelineFeedFlushTimer = window.setTimeout(flushAdminPipelineFeedQueue, 180);
    };

    const flushAdminDeviceStatusQueue = () => {
      adminDeviceStatusFlushTimer = null;
      if (adminDeviceStatusQueue.size === 0) {
        return;
      }
      const queuedStatuses = Array.from(adminDeviceStatusQueue.values());
      adminDeviceStatusQueue.clear();
      setAdminData((previous) => {
        if (!previous) {
          return previous;
        }
        const nextDevices = new Map(previous.devices.map((device) => [device.deviceId, device]));
        let changed = false;
        for (const queuedDevice of queuedStatuses) {
          const existing = nextDevices.get(queuedDevice.deviceId);
          if (existing && sameDeviceStatus(existing, queuedDevice)) {
            continue;
          }
          nextDevices.set(queuedDevice.deviceId, queuedDevice);
          changed = true;
        }
        if (!changed) {
          return previous;
        }
        return {
          ...previous,
          devices: Array.from(nextDevices.values()).sort((a, b) => a.deviceId.localeCompare(b.deviceId))
        };
      });
    };

    const queueAdminDeviceStatus = (deviceStatus: DeviceStatus) => {
      if (isVirtualDeviceId(deviceStatus.deviceId)) {
        return;
      }
      adminDeviceStatusQueue.set(deviceStatus.deviceId, deviceStatus);
      if (adminDeviceStatusFlushTimer !== null) {
        return;
      }
      adminDeviceStatusFlushTimer = window.setTimeout(flushAdminDeviceStatusQueue, 240);
    };

    const studentHandlers: WsDispatchHandlers = {
      'event.feed.append': (eventPayload) => {
        if (studentPauseRef.current) {
          return;
        }
        queueStudentFeedEvent(eventPayload);
      },
      'event.pipeline.append': (eventPayload) => {
        if (studentPauseRef.current) {
          return;
        }
        queueStudentPipelineFeedEvent(eventPayload);
      },
      'group.presence.updated': (payload) => {
        const presence = Array.isArray(payload) ? (payload as PresenceUser[]) : [];
        setStudentData((previous) => {
          if (!previous) {
            return previous;
          }
          if (samePresenceList(previous.groupPresence, presence)) {
            return previous;
          }
          return {
            ...previous,
            groupPresence: presence
          };
        });
      },
      'group.config.updated': (nextConfig) => {
        let changed = false;
        setStudentData((previous) => {
          if (!previous) {
            return previous;
          }
          if (sameGroupConfigMeta(previous.groupConfig, nextConfig)) {
            return previous;
          }
          changed = true;
          return {
            ...previous,
            groupConfig: nextConfig
          };
        });
        if (changed) {
          setStudentConfigDraft(safeConfigMap(nextConfig.config));
        }
      },
      'capabilities.updated': (nextCapabilities) => {
        setStudentData((previous) => {
          if (!previous) {
            return previous;
          }
          if (sameTaskCapabilities(previous.capabilities, nextCapabilities)) {
            return previous;
          }
          return {
            ...previous,
            capabilities: nextCapabilities
          };
        });
      },
      'task.updated': (taskLike) => {
        const task = extractTaskInfo(taskLike as TaskDefinitionPayload | TaskInfo);
        if (!task) {
          return;
        }
        setStudentData((previous) => {
          if (!previous) {
            return previous;
          }
          const nextCapabilities =
            (taskLike as TaskDefinitionPayload).studentCapabilities ?? previous.capabilities;
          if (
            sameTaskInfo(previous.activeTask, task) &&
            sameTaskCapabilities(previous.capabilities, nextCapabilities)
          ) {
            return previous;
          }
          return {
            ...previous,
            activeTask: task,
            capabilities: nextCapabilities
          };
        });
      },
      'error.notification': (payload) => {
        setErrorMessage(String(payload));
      },
      'virtual.device.updated': (virtualDevice) => {
        let changed = false;
        setStudentData((previous) => {
          if (!previous || !previous.settings.studentVirtualDeviceVisible) {
            return previous;
          }
          if (previous.virtualDevice && sameVirtualDeviceState(previous.virtualDevice, virtualDevice)) {
            return previous;
          }
          changed = true;
          return {
            ...previous,
            virtualDevice
          };
        });
        if (changed) {
          const nextPatch = patchFromVirtualDevice(virtualDevice);
          setStudentVirtualPatch((previous) =>
            sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch
          );
        }
      },
      'settings.updated': (settings) => {
        let becameVisible = false;
        let becameHidden = false;
        setStudentData((previous) => {
          if (!previous) {
            return previous;
          }
          becameVisible =
            !previous.settings.studentVirtualDeviceVisible && settings.studentVirtualDeviceVisible;
          becameHidden =
            previous.settings.studentVirtualDeviceVisible && !settings.studentVirtualDeviceVisible;
          const nextVirtualDevice = settings.studentVirtualDeviceVisible
            ? previous.virtualDevice
            : null;
          if (sameAppSettings(previous.settings, settings) && nextVirtualDevice === previous.virtualDevice) {
            return previous;
          }
          return {
            ...previous,
            virtualDevice: nextVirtualDevice,
            settings
          };
        });
        setDefaultLanguageMode(settings.defaultLanguageMode);
        setTimeFormat24h(settings.timeFormat24h);
        if (becameHidden) {
          setStudentVirtualPatch((previous) => (previous === null ? previous : null));
        } else if (becameVisible) {
          api.studentVirtualDevice(token)
            .then((virtualDevice) => {
              setStudentData((previous) => {
                if (!previous || !previous.settings.studentVirtualDeviceVisible) {
                  return previous;
                }
                if (previous.virtualDevice && sameVirtualDeviceState(previous.virtualDevice, virtualDevice)) {
                  return previous;
                }
                return {
                  ...previous,
                  virtualDevice
                };
              });
              const nextPatch = patchFromVirtualDevice(virtualDevice);
              setStudentVirtualPatch((previous) =>
                sameVirtualDevicePatch(previous, nextPatch) ? previous : nextPatch
              );
            })
            .catch((error) => reportBackgroundError('studentVirtualDevice', error));
        }
      },
      'pipeline.state.updated': (view) => {
        onStudentPipelineUpdated(view);
      },
      'pipeline.observability.updated': (update) => {
        onStudentPipelineObservabilityUpdated(update);
      },
      'pipeline.sink.runtime.updated': (update) => {
        onStudentPipelineSinkRuntimeUpdated(update);
      },
      'scenarios.updated': (config) => {
        setFeedScenarioConfig((previous) => {
          if (
            previous &&
            previous.updatedAt === config.updatedAt &&
            previous.updatedBy === config.updatedBy &&
            previous.scenarioOverlays.length === config.scenarioOverlays.length &&
            previous.scenarioOverlays.every((value, index) => value === config.scenarioOverlays[index])
          ) {
            return previous;
          }
          return config;
        });
      }
    };

    const adminHandlers: WsDispatchHandlers = {
      'event.feed.append': (eventPayload) => {
        if (adminPauseRef.current) {
          return;
        }
        queueAdminFeedEvent(eventPayload);
      },
      'event.pipeline.append': (eventPayload) => {
        if (adminPauseRef.current) {
          return;
        }
        queueAdminPipelineFeedEvent(eventPayload);
      },
      'device.status.updated': (deviceStatus) => {
        queueAdminDeviceStatus(deviceStatus);
      },
      'admin.groups.updated': () => {
        scheduleGroupRefresh();
      },
      'task.updated': () => {
        refreshAdminTasks(token).catch((error) => reportBackgroundError('refreshAdminTasks', error));
      },
      'settings.updated': (settings) => {
        setAdminData((previous) => {
          if (!previous) {
            return previous;
          }
          if (sameAppSettings(previous.settings, settings)) {
            return previous;
          }
          return {
            ...previous,
            settings
          };
        });
        setAdminSettingsDraftMode(settings.defaultLanguageMode);
        setAdminSettingsDraftTimeFormat24h(settings.timeFormat24h);
        setAdminSettingsDraftVirtualVisible(settings.studentVirtualDeviceVisible);
        setAdminSettingsDraftAdminDeviceId(settings.adminDeviceId);
        setAdminSettingsDraftVirtualDeviceTopicMode(settings.virtualDeviceTopicMode);
        setDefaultLanguageMode(settings.defaultLanguageMode);
        setTimeFormat24h(settings.timeFormat24h);
      },
      'virtual.device.updated': (updatedVirtual) => {
        setAdminData((previous) => {
          if (!previous) {
            return previous;
          }
          const existing = previous.virtualDevices.find(
            (entry) => entry.deviceId === updatedVirtual.deviceId
          );
          if (existing && sameVirtualDeviceState(existing, updatedVirtual)) {
            return previous;
          }
          const hasExisting = Boolean(existing);
          return {
            ...previous,
            virtualDevices: hasExisting
              ? previous.virtualDevices.map((entry) =>
                  entry.deviceId === updatedVirtual.deviceId ? updatedVirtual : entry
                )
              : [...previous.virtualDevices, updatedVirtual].sort((a, b) =>
                  a.deviceId.localeCompare(b.deviceId)
                )
          };
        });
      },
      'error.notification': (payload) => {
        setErrorMessage(String(payload));
      },
      'pipeline.state.updated': (view) => {
        const selectedGroupKey = selectedAdminPipelineGroupKeyRef.current;
        onAdminPipelineObserved(view, selectedGroupKey);
        if (view.groupKey === selectedGroupKey) {
          onAdminPipelineUpdated(view);
        }
      },
      'pipeline.observability.updated': (update) => {
        const selectedGroupKey = selectedAdminPipelineGroupKeyRef.current;
        onAdminPipelineObservabilityUpdated(update, selectedGroupKey);
      },
      'pipeline.sink.runtime.updated': (update) => {
        const selectedGroupKey = selectedAdminPipelineGroupKeyRef.current;
        onAdminPipelineSinkRuntimeUpdated(update, selectedGroupKey);
      },
      'scenarios.updated': (config) => {
        setFeedScenarioConfig((previous) => {
          if (
            previous &&
            previous.updatedAt === config.updatedAt &&
            previous.updatedBy === config.updatedBy &&
            previous.scenarioOverlays.length === config.scenarioOverlays.length &&
            previous.scenarioOverlays.every((value, index) => value === config.scenarioOverlays[index])
          ) {
            return previous;
          }
          return config;
        });
      }
    };

    const handleEnvelope = (envelope: WsEnvelope<unknown>) => {
      if (session.role === 'STUDENT') {
        dispatchWsEnvelope(envelope, studentHandlers);
        return;
      }
      dispatchWsEnvelope(envelope, adminHandlers);
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
          const envelope = parseWsEnvelope(event.data);
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
      if (studentFeedFlushTimer !== null) {
        window.clearTimeout(studentFeedFlushTimer);
      }
      if (studentPipelineFeedFlushTimer !== null) {
        window.clearTimeout(studentPipelineFeedFlushTimer);
      }
      if (adminFeedFlushTimer !== null) {
        window.clearTimeout(adminFeedFlushTimer);
      }
      if (adminPipelineFeedFlushTimer !== null) {
        window.clearTimeout(adminPipelineFeedFlushTimer);
      }
      if (adminDeviceStatusFlushTimer !== null) {
        window.clearTimeout(adminDeviceStatusFlushTimer);
      }
      studentFeedQueue = [];
      studentPipelineFeedQueue = [];
      adminFeedQueue = [];
      adminPipelineFeedQueue = [];
      adminDeviceStatusQueue.clear();

      if (socket) {
        socket.close();
      }
    };
  }, [
    adminDataRef,
    adminPageRef,
    adminPauseRef,
    flushDeferredAdminFeedEvents,
    markFeedEventsRecent,
    onAdminPipelineObserved,
    onAdminPipelineObservabilityUpdated,
    onAdminPipelineSinkRuntimeUpdated,
    onAdminPipelineUpdated,
    onStudentPipelineObservabilityUpdated,
    onStudentPipelineSinkRuntimeUpdated,
    onStudentPipelineUpdated,
    queueDeferredAdminFeedEvents,
    refreshAdminGroups,
    refreshAdminTasks,
    reportBackgroundError,
    selectedAdminPipelineGroupKeyRef,
    session,
    setAdminData,
    setAdminDeviceIpById,
    setAdminDeviceSnapshots,
    setAdminPipelineFeed,
    setAdminSettingsDraftMode,
    setAdminSettingsDraftTimeFormat24h,
    setAdminSettingsDraftVirtualVisible,
    setAdminSettingsDraftAdminDeviceId,
    setDefaultLanguageMode,
    setFeedScenarioConfig,
    setErrorMessage,
    setStudentConfigDraft,
    setStudentData,
    setStudentPipelineFeed,
    setStudentVirtualPatch,
    setTimeFormat24h,
    setWsConnection,
    studentPauseRef,
    token
  ]);
}
