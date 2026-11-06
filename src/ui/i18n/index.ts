import ru from './ru.json';
import en from './en.json';
import { DEBUG_TOOLS } from '../../core/build';
export type I18nKey = keyof typeof ru | keyof typeof import('../../debug/i18n/ru.json');
const dictionaries: Record<string, Record<string, string>> = { ru, en };
if (DEBUG_TOOLS) {
  const [debugRu, debugEn] = await Promise.all([import('../../debug/i18n/ru.json'), import('../../debug/i18n/en.json')]);
  Object.assign(dictionaries.ru!, debugRu.default); Object.assign(dictionaries.en!, debugEn.default);
}
export function translate(language: string, key: string, params: Record<string, string | number> = {}): string {
  const message = dictionaries[language]?.[key] ?? dictionaries.ru![key] ?? key;
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
