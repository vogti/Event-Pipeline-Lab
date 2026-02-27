import { describe, expect, it, vi } from 'vitest';
import { dispatchWsEnvelope, parseWsEnvelope } from './ws-dispatcher';
import type { CanonicalEvent, PipelineView, WsEnvelope } from '../types';

function createEvent(id: string): CanonicalEvent {
  return {
    id,
    deviceId: 'epld01',
    topic: 'epld/epld01/event/button',
    eventType: 'button.black.press',
    category: 'BUTTON',
    payloadJson: '{"button":"black","state":true}',
    deviceTs: null,
    ingestTs: '2026-01-01T10:00:00Z',
    valid: true,
    validationErrors: null,
    isInternal: false,
    scenarioFlags: '{}',
    groupKey: 'epld01',
    sequenceNo: 1
  };
}

function createPipelineView(): PipelineView {
  return {
    taskId: 'task_intro',
    groupKey: 'epld01',
    input: {
      mode: 'LIVE_MQTT',
      deviceScope: 'GROUP_DEVICES',
      ingestFilters: [],
      scenarioOverlays: []
    },
    processing: {
      mode: 'CONSTRAINED',
      slotCount: 2,
      slots: [
        { index: 0, blockType: 'NONE', config: {} },
        { index: 1, blockType: 'FILTER_DEVICE', config: {} }
      ]
    },
    sink: {
      nodes: [
        { id: 'event-feed', type: 'EVENT_FEED', config: {} },
        { id: 'virtual-signal', type: 'VIRTUAL_SIGNAL', config: {} }
      ],
      targets: ['DEVICE_CONTROL'],
      goal: 'goal'
    },
    sinkRuntime: {
      nodes: [
        { sinkId: 'event-feed', sinkType: 'EVENT_FEED', receivedCount: 8, lastReceivedAt: '2026-01-01T10:00:00Z' },
        { sinkId: 'virtual-signal', sinkType: 'VIRTUAL_SIGNAL', receivedCount: 8, lastReceivedAt: '2026-01-01T10:00:00Z' }
      ]
    },
    permissions: {
      visible: true,
      inputEditable: false,
      processingEditable: true,
      sinkEditable: false,
      stateResetAllowed: true,
      stateRestartAllowed: false,
      lecturerMode: false,
      allowedProcessingBlocks: ['FILTER_DEVICE'],
      slotCount: 2
    },
    observability: {
      sampleEvery: 10,
      maxSamplesPerBlock: 120,
      observedEvents: 0,
      statePersistenceMode: 'EPHEMERAL',
      restartCount: 0,
      lastRestartAt: null,
      lastRestartMode: null,
      blocks: []
    },
    revision: 1,
    updatedAt: '2026-01-01T10:00:00Z',
    updatedBy: 'tester'
  };
}

describe('ws dispatcher', () => {
  it('parses valid ws envelopes and defaults missing ts to null', () => {
    const parsed = parseWsEnvelope('{"type":"event.feed.append","payload":{"x":1}}');
    expect(parsed).toEqual({
      type: 'event.feed.append',
      payload: { x: 1 },
      ts: null
    });
  });

  it('rejects envelopes without a string type', () => {
    expect(() => parseWsEnvelope('{"payload":{"x":1}}')).toThrow('Invalid WebSocket envelope');
    expect(() => parseWsEnvelope('[]')).toThrow('Invalid WebSocket envelope');
  });

  it('dispatches known envelope types to matching handlers', () => {
    const event = createEvent('event-1');
    const onEvent = vi.fn();
    const onPresence = vi.fn();
    const envelope: WsEnvelope<unknown> = {
      type: 'event.feed.append',
      payload: event,
      ts: '2026-01-01T10:00:00Z'
    };

    const handled = dispatchWsEnvelope(envelope, {
      'event.feed.append': onEvent,
      'group.presence.updated': onPresence
    });

    expect(handled).toBe(true);
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onPresence).not.toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(event, {
      type: 'event.feed.append',
      payload: event,
      ts: '2026-01-01T10:00:00Z'
    });
  });

  it('dispatches event.pipeline.append to matching handler', () => {
    const event = createEvent('event-pipeline-1');
    const onPipelineEvent = vi.fn();
    const handled = dispatchWsEnvelope(
      {
        type: 'event.pipeline.append',
        payload: event,
        ts: '2026-01-01T10:00:00Z'
      },
      {
        'event.pipeline.append': onPipelineEvent
      }
    );

    expect(handled).toBe(true);
    expect(onPipelineEvent).toHaveBeenCalledTimes(1);
    expect(onPipelineEvent).toHaveBeenCalledWith(event, {
      type: 'event.pipeline.append',
      payload: event,
      ts: '2026-01-01T10:00:00Z'
    });
  });

  it('returns true for known types even when no handler is registered', () => {
    const handled = dispatchWsEnvelope(
      {
        type: 'settings.updated',
        payload: { defaultLanguageMode: 'EN' },
        ts: null
      },
      {}
    );

    expect(handled).toBe(true);
  });

  it('returns false for unknown envelope types', () => {
    const handled = dispatchWsEnvelope(
      {
        type: 'unknown.event',
        payload: { value: 1 },
        ts: null
      },
      {}
    );

    expect(handled).toBe(false);
  });

  it('dispatches pipeline.state.updated to matching handler', () => {
    const view = createPipelineView();
    const onPipeline = vi.fn();
    const handled = dispatchWsEnvelope(
      {
        type: 'pipeline.state.updated',
        payload: view,
        ts: null
      },
      {
        'pipeline.state.updated': onPipeline
      }
    );

    expect(handled).toBe(true);
    expect(onPipeline).toHaveBeenCalledTimes(1);
    expect(onPipeline).toHaveBeenCalledWith(view, {
      type: 'pipeline.state.updated',
      payload: view,
      ts: null
    });
  });

  it('dispatches pipeline.observability.updated to matching handler', () => {
    const update = {
      taskId: 'task_intro',
      groupKey: 'epld01',
      observability: {
        sampleEvery: 10,
        maxSamplesPerBlock: 120,
        observedEvents: 3,
        statePersistenceMode: 'EPHEMERAL',
        restartCount: 0,
        lastRestartAt: null,
        lastRestartMode: null,
        blocks: []
      }
    };
    const onObservability = vi.fn();
    const handled = dispatchWsEnvelope(
      {
        type: 'pipeline.observability.updated',
        payload: update,
        ts: null
      },
      {
        'pipeline.observability.updated': onObservability
      }
    );

    expect(handled).toBe(true);
    expect(onObservability).toHaveBeenCalledTimes(1);
    expect(onObservability).toHaveBeenCalledWith(update, {
      type: 'pipeline.observability.updated',
      payload: update,
      ts: null
    });
  });

  it('dispatches pipeline.sink.runtime.updated to matching handler', () => {
    const update = {
      taskId: 'task_intro',
      groupKey: 'epld01',
      sinkRuntime: {
        nodes: [
          {
            sinkId: 'virtual-signal',
            sinkType: 'VIRTUAL_SIGNAL',
            receivedCount: 42,
            lastReceivedAt: '2026-01-01T10:00:00Z'
          }
        ]
      }
    };
    const onSinkRuntime = vi.fn();
    const handled = dispatchWsEnvelope(
      {
        type: 'pipeline.sink.runtime.updated',
        payload: update,
        ts: null
      },
      {
        'pipeline.sink.runtime.updated': onSinkRuntime
      }
    );

    expect(handled).toBe(true);
    expect(onSinkRuntime).toHaveBeenCalledTimes(1);
    expect(onSinkRuntime).toHaveBeenCalledWith(update, {
      type: 'pipeline.sink.runtime.updated',
      payload: update,
      ts: null
    });
  });

  it('supports handler-driven state reductions across multiple envelopes', () => {
    const state = {
      events: [] as CanonicalEvent[],
      presenceCount: 0
    };

    const handlers = {
      'event.feed.append': (payload: CanonicalEvent) => {
        state.events = [payload, ...state.events];
      },
      'group.presence.updated': (payload: unknown) => {
        state.presenceCount = Array.isArray(payload) ? payload.length : 0;
      }
    };

    dispatchWsEnvelope(
      {
        type: 'event.feed.append',
        payload: createEvent('event-a'),
        ts: null
      },
      handlers
    );
    dispatchWsEnvelope(
      {
        type: 'event.feed.append',
        payload: createEvent('event-b'),
        ts: null
      },
      handlers
    );
    dispatchWsEnvelope(
      {
        type: 'group.presence.updated',
        payload: [{ username: 'u1' }, { username: 'u2' }],
        ts: null
      },
      handlers
    );

    expect(state.events.map((event) => event.id)).toEqual(['event-b', 'event-a']);
    expect(state.presenceCount).toBe(2);
  });
});
