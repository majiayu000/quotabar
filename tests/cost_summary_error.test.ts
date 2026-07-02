import { describe, expect, test } from 'vitest';
import { getCostSummaryErrorMessage } from '../src/components/CostSummarySection';

describe('getCostSummaryErrorMessage', () => {
  test('preserves string errors returned by Tauri commands', () => {
    expect(getCostSummaryErrorMessage('ccstats pricing cache is missing Codex priority pricing')).toBe(
      'ccstats pricing cache is missing Codex priority pricing',
    );
  });

  test('falls back only for empty or unknown errors', () => {
    expect(getCostSummaryErrorMessage('')).toBe('Failed to load cost summary');
    expect(getCostSummaryErrorMessage(null)).toBe('Failed to load cost summary');
  });
});
