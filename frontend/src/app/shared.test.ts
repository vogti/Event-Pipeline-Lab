import { describe, expect, it } from 'vitest';
import {
  applyFeedScenarioDisturbances,
  buildDeviceTelemetrySnapshots,
  clampFeed,
  eventValueSummary,
  extractCounterValueFromPayload,
  mergeIpAddressCache,
  mergeEventsBounded,
  mergeTelemetrySnapshotCache,
  nextFeedScenarioReleaseAt,
  timestampToEpochMillis,
  tryParsePayload
} from './shared';
import type { CanonicalEvent } from '../types';

function createEvent(
  overrides: Partial<CanonicalEvent> & Pick<CanonicalEvent, 'id'>
): CanonicalEvent {
  return {
    id: overrides.id,
    deviceId: overrides.deviceId ?? 'epld01',
    topic: overrides.topic ?? 'epld/epld01/event/button',
    eventType: overrides.eventType ?? 'button.black.press',
    category: overrides.category ?? 'BUTTON',
    payloadJson: overrides.payloadJson ?? '{}',
    deviceTs: overrides.deviceTs ?? null,
    ingestTs: overrides.ingestTs ?? '2026-01-01T10:00:00Z',
    valid: overrides.valid ?? true,
    validationErrors: overrides.validationErrors ?? null,
    isInternal: overrides.isInternal ?? false,
    scenarioFlags: overrides.scenarioFlags ?? '{}',
    groupKey: overrides.groupKey ?? 'epld01',
    sequenceNo: overrides.sequenceNo ?? null
  };
}

describe('shared helpers', () => {
  it('returns original feed when no disturbance overlays are active', () => {
    const events = [
      createEvent({ id: 'event-a', ingestTs: '2026-01-01T10:00:00Z' }),
      createEvent({ id: 'event-b', ingestTs: '2026-01-01T09:59:00Z' })
    ];

    const disturbed = applyFeedScenarioDisturbances(events, []);
    expect(disturbed).toEqual(events);
  });

  it('applies deterministic drop and duplicate overlays for feed rendering', () => {
    const events = Array.from({ length: 20 }).map((_, index) =>
      createEvent({
        id: `event-${index}`,
        ingestTs: `2026-01-01T10:${String(index).padStart(2, '0')}:00Z`
      })
    );

    const disturbedA = applyFeedScenarioDisturbances(
      events,
      ['duplicates:50%', 'drops:30%', 'out_of_order:40%']
    );
    const disturbedB = applyFeedScenarioDisturbances(
      events,
      ['duplicates:50%', 'drops:30%', 'out_of_order:40%']
    );

    expect(disturbedA.map((event) => event.id)).toEqual(disturbedB.map((event) => event.id));
    expect(disturbedA.length).toBeGreaterThan(0);
    expect(disturbedA.length).not.toBe(events.length);
    expect(disturbedA.some((event) => event.id.includes('::dup'))).toBe(true);
  });

  it('holds delayed events until their release time', () => {
    const baseTs = Date.parse('2026-01-01T10:00:00Z');
    const events = [
      createEvent({ id: 'delayed-a', ingestTs: '2026-01-01T10:00:00Z' }),
      createEvent({ id: 'delayed-b', ingestTs: '2026-01-01T10:00:01Z' })
    ];

    const beforeRelease = applyFeedScenarioDisturbances(events, ['delay:1000ms'], baseTs + 999);
    expect(beforeRelease).toEqual([]);

    const afterRelease = applyFeedScenarioDisturbances(events, ['delay:1000ms'], baseTs + 2500);
    expect(afterRelease.length).toBeGreaterThan(0);

    const expectedIngestById = new Map(
      events.map((event) => {
        const ingestBase = Date.parse(event.ingestTs as string);
        return [event.id, new Date(ingestBase + 1000).toISOString()];
      })
    );
    for (const disturbedEvent of afterRelease) {
      expect(disturbedEvent.ingestTs).toBe(expectedIngestById.get(disturbedEvent.id));
    }
  });

  it('reports next release timestamp for pending delayed events', () => {
    const baseTs = Date.parse('2026-01-01T10:00:00Z');
    const events = [createEvent({ id: 'pending-a', ingestTs: '2026-01-01T10:00:00Z' })];

    const nextRelease = nextFeedScenarioReleaseAt(events, ['delay:1000ms'], baseTs);
    expect(nextRelease).not.toBeNull();
    expect(nextRelease).toBeGreaterThan(baseTs);
  });

  it('uses reorder buffer window to scramble visible order for out-of-order overlays', () => {
    const events = [
      createEvent({ id: 'ooo-a', ingestTs: '2026-01-01T10:00:00Z' }),
      createEvent({ id: 'ooo-b', ingestTs: '2026-01-01T10:00:01Z' }),
      createEvent({ id: 'ooo-c', ingestTs: '2026-01-01T10:00:02Z' })
    ];

    const disturbed = applyFeedScenarioDisturbances(
      events,
      ['out_of_order:100%', 'reorder_buffer:1500ms'],
      Date.parse('2026-01-01T10:00:10Z')
    );
    const naturalNewestFirst = [...events]
      .sort((left, right) => (Date.parse(right.ingestTs as string) - Date.parse(left.ingestTs as string)))
      .map((event) => event.id);

    expect(disturbed.map((event) => event.id)).not.toEqual(naturalNewestFirst);
  });

  it('parses escaped payload JSON used by devices', () => {
    const escapedPayload = '{\\"temperature\\":22.4,\\"humidity\\":52}';
    expect(tryParsePayload(escapedPayload)).toEqual({ temperature: 22.4, humidity: 52 });
  });

  it('keeps event feed bounded, deduplicated and newest first', () => {
    const existing = [
      createEvent({ id: 'event-a', ingestTs: '2026-01-01T10:00:00Z' }),
      createEvent({ id: 'event-b', ingestTs: '2026-01-01T09:59:00Z' })
    ];
    const incoming = [
      createEvent({ id: 'event-a', ingestTs: '2026-01-01T10:00:00Z' }),
      createEvent({ id: 'event-c', ingestTs: '2026-01-01T10:01:00Z' })
    ];

    const merged = mergeEventsBounded(existing, incoming, 2);

    expect(merged).toHaveLength(2);
    expect(merged.map((event) => event.id)).toEqual(['event-c', 'event-a']);
  });

  it('keeps a larger bounded source buffer for disturbance scheduling', () => {
    const source = Array.from({ length: 350 }).map((_, index) =>
      createEvent({
        id: `buffer-${index}`,
        ingestTs: `2026-01-01T10:${String(index % 60).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`
      })
    );

    const clamped = clampFeed(source);
    expect(clamped.length).toBe(350);
  });

  it('maps LED state_changed output payload to on/off value summary', () => {
    const ledEvent = createEvent({
      id: 'event-led',
      topic: 'epld/epld01/event/led/green',
      eventType: 'led.green.state_changed',
      category: 'STATUS',
      payloadJson: '{"output":true}'
    });

    expect(eventValueSummary(ledEvent)).toBe('on');
  });

  it('prefers transformed scalar payload over event-type semantic fallback', () => {
    const transformedButtonEvent = createEvent({
      id: 'event-transform-button',
      topic: 'epld01/event/button/black',
      eventType: 'button.black.press',
      category: 'BUTTON',
      payloadJson: '"on"'
    });

    expect(eventValueSummary(transformedButtonEvent)).toBe('on');
  });

  it('does not show a value for telemetry events', () => {
    const telemetryEvent = createEvent({
      id: 'event-telemetry',
      topic: 'epld/epld01/event/telemetry',
      eventType: 'sensor.telemetry',
      category: 'INTERNAL',
      payloadJson: '{"temperature":23.1}'
    });

    expect(eventValueSummary(telemetryEvent)).toBe('');
  });

  it('shows params.mqtt.connected for status.mqtt events', () => {
    const mqttStatusEvent = createEvent({
      id: 'event-status-mqtt',
      topic: 'epld01/events/rpc',
      eventType: 'status.mqtt',
      category: 'STATUS',
      payloadJson: '{"params":{"mqtt":{"connected":true}}}'
    });

    expect(eventValueSummary(mqttStatusEvent)).toBe('true');
  });

  it('shows Wikimedia title as value summary', () => {
    const wikimediaEvent = createEvent({
      id: 'event-wikimedia-title',
      deviceId: 'wikimedia.eventstream',
      topic: 'wikimedia/enwiki',
      eventType: 'external.wikimedia.edit',
      category: 'SENSOR',
      payloadJson: '{"wiki":"enwiki","title":"OpenAI"}',
      groupKey: null
    });

    expect(eventValueSummary(wikimediaEvent)).toBe('OpenAI');
  });

  it('rejects timestamp-like loose counter values but accepts explicit counter fields', () => {
    const timestampLikeCounter = extractCounterValueFromPayload({ value: 1700000000 }, true);
    const explicitCounter = extractCounterValueFromPayload({ counter: 7 }, true);

    expect(timestampLikeCounter).toBeNull();
    expect(explicitCounter).toBe(7);
  });

  it('parses double-escaped payload strings into objects', () => {
    const payload = '"{\\\\\\"counter\\\\\\":12,\\\\\\"state\\\\\\":true}"';
    expect(tryParsePayload(payload)).toEqual({ counter: 12, state: true });
  });

  it('treats numeric timestamps in seconds and milliseconds consistently', () => {
    expect(timestampToEpochMillis(1_700_000_000)).toBe(1_700_000_000_000);
    expect(timestampToEpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('extracts telemetry snapshots from mixed payload shapes', () => {
    const events = [
      createEvent({
        id: 'event-sensor',
        topic: 'epld/epld01/event/sensor/dht22',
        eventType: 'sensor.dht22.read',
        category: 'SENSOR',
        payloadJson: '{"params":{"temperature:100":{"tC":21.6},"humidity:100":{"rh":46}}}'
      }),
      createEvent({
        id: 'event-brightness',
        topic: 'epld/epld01/event/sensor/ldr',
        eventType: 'sensor.ldr.read',
        category: 'SENSOR',
        payloadJson: '{"params":{"voltmeter:100":{"voltage":2.41}}}'
      }),
      createEvent({
        id: 'event-counter',
        topic: 'epld/epld01/event/counter',
        eventType: 'counter.blue.changed',
        category: 'COUNTER',
        payloadJson: '{"params":{"counter:0":{"value":9}}}'
      }),
      createEvent({
        id: 'event-uptime',
        topic: 'epld/epld01/status/heartbeat',
        eventType: 'status.heartbeat',
        category: 'STATUS',
        ingestTs: '2026-01-01T10:02:00Z',
        payloadJson: '{"sys":{"uptime":123}}'
      })
    ];

    const snapshots = buildDeviceTelemetrySnapshots(events);
    expect(snapshots.epld01).toMatchObject({
      temperatureC: 21.6,
      humidityPct: 46,
      brightness: 2.41,
      counterValue: 9,
      uptimeMs: 123_000,
      uptimeIngestTs: '2026-01-01T10:02:00Z'
    });
  });

  it('keeps previously cached telemetry values when latest batch has nulls', () => {
    const previous = {
      epld01: {
        temperatureC: 21.6,
        humidityPct: 46,
        brightness: 2.41,
        counterValue: 9,
        buttonRedPressed: true,
        buttonBlackPressed: false,
        ledGreenOn: true,
        ledOrangeOn: false,
        uptimeMs: 123_000,
        uptimeIngestTs: '2026-01-01T10:02:00Z'
      }
    };

    const latest = {
      epld01: {
        temperatureC: null,
        humidityPct: null,
        brightness: null,
        counterValue: null,
        buttonRedPressed: null,
        buttonBlackPressed: null,
        ledGreenOn: null,
        ledOrangeOn: null,
        uptimeMs: null,
        uptimeIngestTs: null
      }
    };

    const merged = mergeTelemetrySnapshotCache(previous, latest);
    expect(merged.epld01).toEqual(previous.epld01);
  });

  it('keeps latest telemetry values regardless of incoming batch order', () => {
    const events = [
      createEvent({
        id: 'newest-temp',
        ingestTs: '2026-01-01T10:00:03Z',
        topic: 'epld01/event/sensor/temperature',
        eventType: 'sensor.temperature.read',
        category: 'SENSOR',
        payloadJson: '{"temperature":22.9}'
      }),
      createEvent({
        id: 'older-temp',
        ingestTs: '2026-01-01T10:00:01Z',
        topic: 'epld01/event/sensor/temperature',
        eventType: 'sensor.temperature.read',
        category: 'SENSOR',
        payloadJson: '{"temperature":20.1}'
      }),
      createEvent({
        id: 'newest-led',
        ingestTs: '2026-01-01T10:00:04Z',
        topic: 'epld01/event/led/green',
        eventType: 'led.green.state_changed',
        category: 'STATUS',
        payloadJson: '{"output":true}'
      }),
      createEvent({
        id: 'older-led',
        ingestTs: '2026-01-01T10:00:02Z',
        topic: 'epld01/event/led/green',
        eventType: 'led.green.state_changed',
        category: 'STATUS',
        payloadJson: '{"output":false}'
      }),
      createEvent({
        id: 'newest-uptime',
        ingestTs: '2026-01-01T10:00:05Z',
        topic: 'epld01/status/heartbeat',
        eventType: 'status.heartbeat',
        category: 'STATUS',
        payloadJson: '{"sys":{"uptime":125}}'
      }),
      createEvent({
        id: 'older-uptime',
        ingestTs: '2026-01-01T10:00:00Z',
        topic: 'epld01/status/heartbeat',
        eventType: 'status.heartbeat',
        category: 'STATUS',
        payloadJson: '{"sys":{"uptime":120}}'
      })
    ];

    const snapshots = buildDeviceTelemetrySnapshots(events);
    expect(snapshots.epld01).toMatchObject({
      temperatureC: 22.9,
      ledGreenOn: true,
      uptimeMs: 125_000,
      uptimeIngestTs: '2026-01-01T10:00:05Z'
    });
  });

  it('merges ip cache by active devices and prunes removed ids', () => {
    const previous = { epld01: '192.168.1.10', epld02: '192.168.1.11' };
    const latest = { epld01: '192.168.1.20' };
    const merged = mergeIpAddressCache(previous, latest, ['epld01']);

    expect(merged).toEqual({ epld01: '192.168.1.20' });
  });
});
