import { describe, expect, test } from 'vitest';
import { BACKEND_UNAVAILABLE_MESSAGE, backend, hasTauriBackend } from '../src/services/backend';

describe('backend browser preview guard', () => {
  test('detects that browser preview is outside the Tauri runtime', () => {
    expect(hasTauriBackend()).toBe(false);
  });

  test('reports an explicit error outside the Tauri desktop runtime', async () => {
    await expect(backend.getQuota()).rejects.toThrow(BACKEND_UNAVAILABLE_MESSAGE);
  });
});
