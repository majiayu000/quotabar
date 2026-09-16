import { readStorageValue, writeStorageItem } from '../services/storage';
import { messages, type MessageKey } from './messages';

export type Locale = 'en' | 'zh-CN';
export type LanguagePreference = 'system' | Locale;
export const LANGUAGE_STORAGE_KEY = 'quotabar.language';
const listeners = new Set<() => void>();
let preference: LanguagePreference = 'system';
let locale: Locale = resolveLocale(preference);

export function resolveLocale(value: LanguagePreference, languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages): Locale {
  if (value !== 'system') return value;
  return languages[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function getLocale(): Locale { return locale; }
export function getLanguagePreference(): LanguagePreference { return preference; }
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function applyPreference(value: LanguagePreference): void {
  preference = value;
  locale = resolveLocale(value);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

export function setLanguagePreference(value: LanguagePreference): boolean {
  const saved = writeStorageItem(LANGUAGE_STORAGE_KEY, value, { preserveSessionValue: true, notifyUser: true });
  applyPreference(value);
  return saved;
}

function readPreference(): LanguagePreference {
  const result = readStorageValue(LANGUAGE_STORAGE_KEY, (raw): LanguagePreference => {
    if (raw !== 'system' && raw !== 'en' && raw !== 'zh-CN') throw new Error('Invalid language preference');
    return raw;
  }, { notifyUser: true });
  return result.status === 'value' ? result.value : 'system';
}

/** Called once per webview. Storage events synchronize the tray and workspace. */
export function initializeI18n(): () => void {
  applyPreference(readPreference());
  const onStorage = (event: StorageEvent) => {
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) applyPreference(readPreference());
  };
  const onSystemLanguage = () => { if (preference === 'system') applyPreference('system'); };
  window.addEventListener('storage', onStorage);
  window.addEventListener('languagechange', onSystemLanguage);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('languagechange', onSystemLanguage);
  };
}

type ParametersOf<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | ParametersOf<Rest> : never;
type MessageArguments<K extends MessageKey> = [ParametersOf<K>] extends [never] ? [] : [values: Record<ParametersOf<K>, string | number>];

export interface Message {
  key: MessageKey;
  values: Record<string, string | number>;
}
export type DisplayText = string | Message;

export function message<K extends MessageKey>(key: K, ...args: MessageArguments<K>): Message {
  return { key, values: args[0] ?? {} };
}

/** Values stay data until rendering, so persisted events can change language too. */
export function renderText(value: DisplayText, language: Locale = locale): string {
  if (typeof value === 'string') return localizeLabel(value, language);
  const template: string = messages[language][value.key];
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    if (!(name in value.values)) throw new Error(`Missing translation parameter: ${value.key} / ${name}`);
    return String(value.values[name]);
  });
}

export function t<K extends MessageKey>(key: K, ...args: MessageArguments<K>): string {
  return renderText(message(key, ...args));
}

/** Validate persisted message data at the storage boundary. Raw diagnostics are strings. */
export function isDisplayText(value: unknown): value is DisplayText {
  if (typeof value === 'string') return true;
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Message>;
  if (typeof candidate.key !== 'string' || !Object.prototype.hasOwnProperty.call(messages.en, candidate.key)) return false;
  if (!candidate.values || typeof candidate.values !== 'object' || Array.isArray(candidate.values)) return false;
  const required = [...candidate.key.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
  return required.every((name) => typeof candidate.values![name] === 'string' || typeof candidate.values![name] === 'number');
}

/** Only for source labels and diagnostic constants; unknown provider text stays verbatim. */
export function localizeLabel(label: string, language: Locale = locale): string {
  const source = label.startsWith('Error: ') ? label.slice(7) : label;
  if (!Object.prototype.hasOwnProperty.call(messages.en, source)) return label;
  return messages[language][source as MessageKey];
}
