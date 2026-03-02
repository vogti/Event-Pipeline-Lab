import { describe, expect, it } from 'vitest';
import {
  buildGuidedMqttMessage,
  createMqttEventDraft,
  lockTopicToDevicePrefix,
  normalizeLegacyLedCommandTopic,
  normalizeMqttTemplateForTarget,
  resolveMqttDeviceId,
  topicSuffixForLockedPrefix,
  topicSuffixWithoutDevicePrefix
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
    expect(result.topic).toBe('epld01/event/button');
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

  it('builds physical led command topics with plain on/off payload', () => {
    const draft = createMqttEventDraft();
    draft.targetType = 'physical';
    draft.template = 'led';
    draft.deviceId = 'epld04';
    draft.ledColor = 'orange';
    draft.ledOn = false;

    const result = buildGuidedMqttMessage(draft);
    expect(result.topic).toBe('epld04/command/led/orange');
    expect(result.payload).toBe('off');
  });

  it('resolves default device id from available target list', () => {
    expect(resolveMqttDeviceId('physical', '', ['epld03'], ['eplvd03'])).toBe('epld03');
    expect(resolveMqttDeviceId('virtual', 'eplvd05', ['epld03'], ['eplvd03'])).toBe('eplvd03');
    expect(resolveMqttDeviceId('custom', 'custom-topic', ['epld03'], ['eplvd03'])).toBe('custom-topic');
  });

  it('extracts topic suffix and applies locked device prefixes', () => {
    expect(topicSuffixWithoutDevicePrefix('epld01/events/rpc')).toBe('events/rpc');
    expect(topicSuffixWithoutDevicePrefix('events/rpc')).toBe('events/rpc');

    expect(topicSuffixForLockedPrefix('epld01', 'epld01/events/rpc')).toBe('events/rpc');
    expect(topicSuffixForLockedPrefix('epld01', 'epld09/events/rpc')).toBe('events/rpc');
    expect(topicSuffixForLockedPrefix('epld01', 'events/rpc')).toBe('events/rpc');

    expect(lockTopicToDevicePrefix('epld01', 'events/rpc')).toBe('epld01/events/rpc');
    expect(lockTopicToDevicePrefix('epld01', 'epld09/events/rpc')).toBe('epld01/events/rpc');
    expect(lockTopicToDevicePrefix('epld01', 'epld01/events/rpc')).toBe('epld01/events/rpc');
  });

  it('normalizes legacy switch command topics to led command topics', () => {
    expect(normalizeLegacyLedCommandTopic('epld01/command/switch:0')).toBe('epld01/command/led/green');
    expect(normalizeLegacyLedCommandTopic('/epld01/command/switch:1')).toBe('/epld01/command/led/orange');
    expect(normalizeLegacyLedCommandTopic('command/switch:0')).toBe('command/led/green');
    expect(normalizeLegacyLedCommandTopic('epld01/command/led/green')).toBe('epld01/command/led/green');
  });
});
