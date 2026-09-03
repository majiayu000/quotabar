import { describe, expect, test } from 'vitest';
import { bonusReadyEntered, formatBonusReadyMessage } from '../src/services/bonus_ready';

describe('bonusReadyEntered', () => {
  test('does not fire on the first snapshot', () => {
    expect(bonusReadyEntered(null, { exhausted: true, availableCount: 1 })).toBe(false);
  });

  test('fires when usage crosses 100% with an existing credit', () => {
    expect(bonusReadyEntered(
      { exhausted: false, availableCount: 1 },
      { exhausted: true, availableCount: 1 },
    )).toBe(true);
  });

  test('fires when a credit arrives while already exhausted', () => {
    expect(bonusReadyEntered(
      { exhausted: true, availableCount: 0 },
      { exhausted: true, availableCount: 1 },
    )).toBe(true);
  });

  test('does not fire when exhausted with an unchanged credit', () => {
    expect(bonusReadyEntered(
      { exhausted: true, availableCount: 1 },
      { exhausted: true, availableCount: 1 },
    )).toBe(false);
  });

  test('does not fire at 100% with zero credits', () => {
    expect(bonusReadyEntered(
      { exhausted: false, availableCount: 0 },
      { exhausted: true, availableCount: 0 },
    )).toBe(false);
  });
});

describe('formatBonusReadyMessage', () => {
  test('uses singular copy for one credit', () => {
    expect(formatBonusReadyMessage(1)).toBe('Codex weekly is at 100%. 1 bonus reset available.');
  });

  test('uses plural copy for multiple credits', () => {
    expect(formatBonusReadyMessage(2)).toBe('Codex weekly is at 100%. 2 bonus resets available.');
  });
});
