// 初始化 i18next：首次访问按浏览器语言选择，用户手动切换后记住选择。
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { defaultNS, resources } from './resources';

export const LANGUAGES = ['zh', 'en'] as const;
/** 支持的界面语言。 */
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'ocs_lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS,
    ns: Object.keys(resources.en),
    fallbackLng: 'en',
    supportedLngs: LANGUAGES,
    // zh-CN、zh-TW、en-GB 等地区变体归并到基础语言。
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    // 资源随代码打包，同步初始化，首屏不会因加载翻译而闪烁。
    initAsync: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: STORAGE_KEY,
      // 只有用户主动切换才写入，未切换前始终跟随浏览器语言。
      caches: [],
    },
    react: { useSuspense: false },
  });

/** 读取当前生效的界面语言。
 * @returns 已解析的支持语言。
 * @throws 不适用。
 */
export function currentLanguage(): Language {
  return i18n.resolvedLanguage === 'zh' ? 'zh' : 'en';
}

/** 返回用于 Intl 的区域标签；浏览器语言与界面语言一致时保留其地区变体。
 * @returns BCP 47 区域标签。
 * @throws 不适用。
 */
export function intlLocale(): string {
  const language = currentLanguage();
  const browser = typeof navigator === 'undefined' ? '' : navigator.language;
  if (browser.toLowerCase().startsWith(language)) return browser;
  return language === 'zh' ? 'zh-CN' : 'en-US';
}

/** 切换界面语言并记住用户选择。
 * @param language 目标语言。
 * @returns 切换完成。
 * @throws 不适用；存储不可用时仅本次会话生效。
 */
export async function setLanguage(language: Language): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // 存储被禁用时仍切换本次会话的语言。
  }
  await i18n.changeLanguage(language);
}

/** 同步 <html lang>，让读屏软件和中文字体回退按语言工作。
 * @returns 不适用。
 * @throws 不适用。
 */
function syncDocumentLanguage(): void {
  // 单元测试运行在 Node 环境，没有 document。
  if (typeof document === 'undefined') return;
  document.documentElement.lang = currentLanguage() === 'zh' ? 'zh-CN' : 'en';
}

syncDocumentLanguage();
i18n.on('languageChanged', syncDocumentLanguage);

export default i18n;
