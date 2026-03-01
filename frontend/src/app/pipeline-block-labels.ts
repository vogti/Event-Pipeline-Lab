export function displayPipelineBlockType(blockType: string): string {
  const normalized = blockType.trim().toUpperCase();
  if (normalized === 'FILTER_DEVICE') {
    return 'FILTER_SOURCE';
  }
  return normalized.length > 0 ? normalized : blockType;
}
