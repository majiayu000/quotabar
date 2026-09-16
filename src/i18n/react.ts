import { useSyncExternalStore } from 'react';
import { getLanguagePreference, getLocale, subscribeLocale } from './index';

/** Subscribe at the rendering boundary; changing language never remounts provider state. */
export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function useLanguagePreference() {
  return useSyncExternalStore(subscribeLocale, getLanguagePreference, getLanguagePreference);
}
