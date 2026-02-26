import { describe, expect, it } from 'vitest';
import {
  buildPipelineScenarioOverlays,
  parsePipelineScenarioOverlays,
  withScenarioValue
} from './pipeline-scenarios';

describe('pipeline-scenarios', () => {
  it('parses known overlays with aliases', () => {
    expect(
      parsePipelineScenarioOverlays([
        'duplicates:12%',
        'delay:450ms',
        'drop:7%',
        'out-of-order:9%',
        'reorder-buffer:1200ms'
      ])
    ).toEqual({
      duplicates: 12,
      delay: 450,
      drops: 7,
      out_of_order: 9,
      reorder_buffer: 1200
    });
  });

  it('builds canonical overlay tokens in stable order', () => {
    expect(
      buildPipelineScenarioOverlays({
        delay: 320,
        out_of_order: 5,
        duplicates: 10,
        reorder_buffer: 800
      })
    ).toEqual(['duplicates:10%', 'delay:320ms', 'out_of_order:5%', 'reorder_buffer:800ms']);
  });

  it('handles set and unset helpers', () => {
    const first = withScenarioValue({}, 'duplicates', 8);
    expect(first).toEqual({ duplicates: 8 });

    const second = withScenarioValue(first, 'duplicates', null);
    expect(second).toEqual({});
  });
});
