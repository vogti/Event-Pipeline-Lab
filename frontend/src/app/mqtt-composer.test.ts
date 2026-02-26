import { describe, expect, it } from 'vitest';
import {
  buildGuidedMqttMessage,
  createMqttEventDraft,
  normalizeMqttTemplateForTarget,
  resolveMqttDeviceId
} from './mqtt-composer';

describe('mqtt composer', () => {
  it('builds physical button event topics and payload', () => {
    const draft = createMqttEventDraft();
    draft.targetType = 'physical';
    draft.template = 'button';
    draft.deviceId = 'epld01';
    draft.buttonColor = 'black';
    draft.buttonPressed = true;

    const result = buildGuidedMqttMessage(draft, 1_700_000_000_000);
    expect(result.topic).toBe('epld/epld01/event/button');
    expect(JSON.parse(result.payload)).toMatchObject({
      button: 'black',
      action: 'press',
      pressed: true
    });
  });

  it('builds virtual counter events in NotifyStatus format', () => {
    const draft = createMqttEventDraft();
    draft.targetType = 'virtual';
    draft.template = 'counter';
    draft.deviceId = 'eplvd02';
    draft.counterValue = 12.2;

    const result = buildGuidedMqttMessage(draft, 1_700_000_000_000);
    expect(result.topic).toBe('eplvd02/events/rpc');
    expect(JSON.parse(result.payload)).toMatchObject({
      deviceId: 'eplvd02',
      method: 'NotifyStatus',
      params: {
        'input:2': { state: true },
        'counter:0': { value: 12 }
      }
    });
  });

  it('normalizes unsupported templates for virtual targets', () => {
    expect(normalizeMqttTemplateForTarget('virtual', 'wifi')).toBe('button');
  });

  it('resolves default device id from available target list', () => {
    expect(resolveMqttDeviceId('physical', '', ['epld03'], ['eplvd03'])).toBe('epld03');
    expect(resolveMqttDeviceId('virtual', 'eplvd05', ['epld03'], ['eplvd03'])).toBe('eplvd03');
    expect(resolveMqttDeviceId('custom', 'custom-topic', ['epld03'], ['eplvd03'])).toBe('custom-topic');
  });
});
