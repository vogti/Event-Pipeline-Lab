import type {
  AppSettings,
  CanonicalEvent,
  DeviceStatus,
  GroupConfig,
  PipelineObservabilityUpdate,
  PipelineView,
  PresenceUser,
  FeedScenarioConfig,
  TaskCapabilities,
  TaskDefinitionPayload,
  TaskInfo,
  TimestampValue,
  VirtualDeviceState,
  WsEnvelope
} from '../types';

export type WsEventType =
  | 'event.feed.append'
  | 'group.presence.updated'
  | 'group.config.updated'
  | 'capabilities.updated'
  | 'task.updated'
  | 'error.notification'
  | 'virtual.device.updated'
  | 'settings.updated'
  | 'device.status.updated'
  | 'admin.groups.updated'
  | 'pipeline.state.updated'
  | 'pipeline.observability.updated'
  | 'scenarios.updated';

export interface WsPayloadByType {
  'event.feed.append': CanonicalEvent;
  'group.presence.updated': PresenceUser[] | unknown;
  'group.config.updated': GroupConfig;
  'capabilities.updated': TaskCapabilities;
  'task.updated': TaskDefinitionPayload | TaskInfo;
  'error.notification': unknown;
  'virtual.device.updated': VirtualDeviceState;
  'settings.updated': AppSettings;
  'device.status.updated': DeviceStatus;
  'admin.groups.updated': unknown;
  'pipeline.state.updated': PipelineView;
  'pipeline.observability.updated': PipelineObservabilityUpdate;
  'scenarios.updated': FeedScenarioConfig;
}

export type KnownWsEnvelope<K extends WsEventType = WsEventType> = {
  type: K;
  payload: WsPayloadByType[K];
  ts: TimestampValue;
};

type WsHandler<K extends WsEventType> = (
  payload: WsPayloadByType[K],
  envelope: KnownWsEnvelope<K>
) => void;

export type WsDispatchHandlers = {
  [K in WsEventType]?: WsHandler<K>;
};

function toKnownEnvelope<K extends WsEventType>(
  envelope: WsEnvelope<unknown>,
  type: K
): KnownWsEnvelope<K> {
  return {
    type,
    payload: envelope.payload as WsPayloadByType[K],
    ts: envelope.ts
  };
}

export function parseWsEnvelope(rawData: string): WsEnvelope<unknown> {
  const parsed = JSON.parse(rawData) as Partial<WsEnvelope<unknown>>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('Invalid WebSocket envelope');
  }
  return {
    type: parsed.type,
    payload: parsed.payload,
    ts: (parsed.ts ?? null) as TimestampValue
  };
}

export function dispatchWsEnvelope(
  envelope: WsEnvelope<unknown>,
  handlers: WsDispatchHandlers
): boolean {
  switch (envelope.type) {
    case 'event.feed.append':
      handlers['event.feed.append']?.(
        envelope.payload as WsPayloadByType['event.feed.append'],
        toKnownEnvelope(envelope, 'event.feed.append')
      );
      return true;
    case 'group.presence.updated':
      handlers['group.presence.updated']?.(
        envelope.payload as WsPayloadByType['group.presence.updated'],
        toKnownEnvelope(envelope, 'group.presence.updated')
      );
      return true;
    case 'group.config.updated':
      handlers['group.config.updated']?.(
        envelope.payload as WsPayloadByType['group.config.updated'],
        toKnownEnvelope(envelope, 'group.config.updated')
      );
      return true;
    case 'capabilities.updated':
      handlers['capabilities.updated']?.(
        envelope.payload as WsPayloadByType['capabilities.updated'],
        toKnownEnvelope(envelope, 'capabilities.updated')
      );
      return true;
    case 'task.updated':
      handlers['task.updated']?.(
        envelope.payload as WsPayloadByType['task.updated'],
        toKnownEnvelope(envelope, 'task.updated')
      );
      return true;
    case 'error.notification':
      handlers['error.notification']?.(
        envelope.payload as WsPayloadByType['error.notification'],
        toKnownEnvelope(envelope, 'error.notification')
      );
      return true;
    case 'virtual.device.updated':
      handlers['virtual.device.updated']?.(
        envelope.payload as WsPayloadByType['virtual.device.updated'],
        toKnownEnvelope(envelope, 'virtual.device.updated')
      );
      return true;
    case 'settings.updated':
      handlers['settings.updated']?.(
        envelope.payload as WsPayloadByType['settings.updated'],
        toKnownEnvelope(envelope, 'settings.updated')
      );
      return true;
    case 'device.status.updated':
      handlers['device.status.updated']?.(
        envelope.payload as WsPayloadByType['device.status.updated'],
        toKnownEnvelope(envelope, 'device.status.updated')
      );
      return true;
    case 'admin.groups.updated':
      handlers['admin.groups.updated']?.(
        envelope.payload as WsPayloadByType['admin.groups.updated'],
        toKnownEnvelope(envelope, 'admin.groups.updated')
      );
      return true;
    case 'pipeline.state.updated':
      handlers['pipeline.state.updated']?.(
        envelope.payload as WsPayloadByType['pipeline.state.updated'],
        toKnownEnvelope(envelope, 'pipeline.state.updated')
      );
      return true;
    case 'pipeline.observability.updated':
      handlers['pipeline.observability.updated']?.(
        envelope.payload as WsPayloadByType['pipeline.observability.updated'],
        toKnownEnvelope(envelope, 'pipeline.observability.updated')
      );
      return true;
    case 'scenarios.updated':
      handlers['scenarios.updated']?.(
        envelope.payload as WsPayloadByType['scenarios.updated'],
        toKnownEnvelope(envelope, 'scenarios.updated')
      );
      return true;
    default:
      return false;
  }
}
