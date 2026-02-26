export type PipelineScenarioKey =
  | 'duplicates'
  | 'delay'
  | 'drops'
  | 'out_of_order'
  | 'reorder_buffer';

export interface PipelineScenarioDefinition {
  key: PipelineScenarioKey;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  unit: '%' | 'ms';
}

export const PIPELINE_SCENARIO_DEFINITIONS: PipelineScenarioDefinition[] = [
  {
    key: 'duplicates',
    min: 1,
    max: 100,
    step: 1,
    defaultValue: 10,
    unit: '%'
  },
  {
    key: 'delay',
    min: 50,
    max: 10000,
    step: 100,
    defaultValue: 300,
    unit: 'ms'
  },
  {
    key: 'drops',
    min: 1,
    max: 100,
    step: 1,
    defaultValue: 5,
    unit: '%'
  },
  {
    key: 'out_of_order',
    min: 1,
    max: 100,
    step: 1,
    defaultValue: 10,
    unit: '%'
  },
  {
    key: 'reorder_buffer',
    min: 100,
    max: 10000,
    step: 100,
    defaultValue: 1000,
    unit: 'ms'
  }
];

const DEF_BY_KEY = new Map(PIPELINE_SCENARIO_DEFINITIONS.map((definition) => [definition.key, definition]));

const DUPLICATES_REGEX = /^(duplicates?)\s*:\s*(\d+)\s*%?$/i;
const DELAY_REGEX = /^(delay)\s*:\s*(\d+)\s*ms?$/i;
const DROPS_REGEX = /^(drop|drops)\s*:\s*(\d+)\s*%?$/i;
const OUT_OF_ORDER_REGEX = /^(out[_-]?of[_-]?order|out_of_order)\s*:\s*(\d+)\s*%?$/i;
const REORDER_BUFFER_REGEX =
  /^(reorder[_-]?buffer|reorder_buffer|out[_-]?of[_-]?order[_-]?buffer|out_of_order_buffer)\s*:\s*(\d+)\s*ms?$/i;

function clampScenarioValue(key: PipelineScenarioKey, value: number): number {
  const definition = DEF_BY_KEY.get(key);
  if (!definition || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > definition.max) {
    return definition.max;
  }
  return Math.round(value);
}

function parseToken(raw: string): [PipelineScenarioKey, number] | null {
  const trimmed = raw.trim();
  let match = trimmed.match(DUPLICATES_REGEX);
  if (match) {
    return ['duplicates', Number.parseInt(match[2] ?? '0', 10)];
  }
  match = trimmed.match(DELAY_REGEX);
  if (match) {
    return ['delay', Number.parseInt(match[2] ?? '0', 10)];
  }
  match = trimmed.match(DROPS_REGEX);
  if (match) {
    return ['drops', Number.parseInt(match[2] ?? '0', 10)];
  }
  match = trimmed.match(OUT_OF_ORDER_REGEX);
  if (match) {
    return ['out_of_order', Number.parseInt(match[2] ?? '0', 10)];
  }
  match = trimmed.match(REORDER_BUFFER_REGEX);
  if (match) {
    return ['reorder_buffer', Number.parseInt(match[2] ?? '0', 10)];
  }
  return null;
}

export function parsePipelineScenarioOverlays(
  overlays: string[] | null | undefined
): Partial<Record<PipelineScenarioKey, number>> {
  if (!overlays || overlays.length === 0) {
    return {};
  }
  const next: Partial<Record<PipelineScenarioKey, number>> = {};
  for (const token of overlays) {
    if (!token) {
      continue;
    }
    const parsed = parseToken(token);
    if (!parsed) {
      continue;
    }
    const [key, rawValue] = parsed;
    const value = clampScenarioValue(key, rawValue);
    if (value > 0) {
      next[key] = value;
    } else {
      delete next[key];
    }
  }
  return next;
}

export function buildPipelineScenarioOverlays(
  values: Partial<Record<PipelineScenarioKey, number>>
): string[] {
  const normalized: Partial<Record<PipelineScenarioKey, number>> = {};
  for (const definition of PIPELINE_SCENARIO_DEFINITIONS) {
    const rawValue = values[definition.key];
    if (rawValue === undefined || rawValue === null) {
      continue;
    }
    const value = clampScenarioValue(definition.key, rawValue);
    if (value <= 0) {
      continue;
    }
    normalized[definition.key] = value;
  }

  return PIPELINE_SCENARIO_DEFINITIONS.flatMap((definition) => {
    const value = normalized[definition.key];
    if (value === undefined) {
      return [];
    }
    if (definition.unit === 'ms') {
      return [`${definition.key}:${value}ms`];
    }
    return [`${definition.key}:${value}%`];
  });
}

export function withScenarioValue(
  values: Partial<Record<PipelineScenarioKey, number>>,
  key: PipelineScenarioKey,
  value: number | null
): Partial<Record<PipelineScenarioKey, number>> {
  const next = { ...values };
  if (value === null) {
    delete next[key];
    return next;
  }
  const normalized = clampScenarioValue(key, value);
  if (normalized <= 0) {
    delete next[key];
    return next;
  }
  next[key] = normalized;
  return next;
}

export function scenarioDefaultValue(key: PipelineScenarioKey): number {
  return DEF_BY_KEY.get(key)?.defaultValue ?? 1;
}
