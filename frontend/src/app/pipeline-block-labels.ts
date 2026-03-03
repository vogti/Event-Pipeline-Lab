export function displayPipelineBlockType(blockType: string): string {
  const normalized = blockType.trim().toUpperCase();
  if (normalized === 'FILTER_DEVICE') {
    return 'FILTER_SOURCE';
  }
  if (normalized === 'FILTER_VALUE') {
    return 'FILTER_PAYLOAD';
  }
  return normalized.length > 0 ? normalized : blockType;
}
