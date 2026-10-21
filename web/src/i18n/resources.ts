// 汇总全部翻译资源；英文是类型基准，中文通过 Translation 约束保持键一致。
import enAuth from './locales/en/auth';
import enCommon from './locales/en/common';
import enDashboard from './locales/en/dashboard';
import enErrors from './locales/en/errors';
import enInstances from './locales/en/instances';
import enJobs from './locales/en/jobs';
import enOperations from './locales/en/operations';
import enRuns from './locales/en/runs';
import zhAuth from './locales/zh/auth';
import zhCommon from './locales/zh/common';
import zhDashboard from './locales/zh/dashboard';
import zhErrors from './locales/zh/errors';
import zhInstances from './locales/zh/instances';
import zhJobs from './locales/zh/jobs';
import zhOperations from './locales/zh/operations';
import zhRuns from './locales/zh/runs';

export const defaultNS = 'common';

export const resources = {
  en: {
    common: enCommon,
    errors: enErrors,
    auth: enAuth,
    dashboard: enDashboard,
    instances: enInstances,
    jobs: enJobs,
    runs: enRuns,
    operations: enOperations,
  },
  zh: {
    common: zhCommon,
    errors: zhErrors,
    auth: zhAuth,
    dashboard: zhDashboard,
    instances: zhInstances,
    jobs: zhJobs,
    runs: zhRuns,
    operations: zhOperations,
  },
} as const;
