import { describe, expect, it, vi } from 'vitest';
import { dispatchWsEnvelope, parseWsEnvelope } from './ws-dispatcher';
import type { CanonicalEvent, WsEnvelope } from '../types';

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
