import { describe, expect, test } from 'vitest';
import { BACKEND_UNAVAILABLE_MESSAGE, backend } from '../src/services/backend';

describe('backend browser preview guard', () => {
  test('reports an explicit error outside the Tauri desktop runtime', async () => {
    await expect(backend.getQuota()).rejects.toThrow(BACKEND_UNAVAILABLE_MESSAGE);
  });
});
