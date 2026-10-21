// 让 t() 的键、命名空间与插值变量受英文资源类型检查。
import 'i18next';
import type { defaultNS, resources } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['en'];
  }
}
