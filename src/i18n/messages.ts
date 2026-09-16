import { en } from './en';
import { zhCN } from './zh-CN';

export const messages = { en, 'zh-CN': zhCN } as const;
export type MessageKey = keyof typeof en;
