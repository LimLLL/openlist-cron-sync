// 声明按路由拆分的私有页面，并在登录后空闲时预取，首次进入页面无需等待网络。
import { lazy } from 'react';

const loaders = {
  password: () => import('../features/auth/password-page'),
  overview: () => import('../features/dashboard/overview-page'),
  instances: () => import('../features/instances/instances-page'),
  instanceDetail: () => import('../features/instances/instance-detail-page'),
  instanceForm: () => import('../features/instances/instance-form-pages'),
  jobs: () => import('../features/jobs/jobs-page'),
  jobDetail: () => import('../features/jobs/job-detail-page'),
  jobForm: () => import('../features/jobs/job-form-pages'),
  runs: () => import('../features/runs/runs-page'),
  runDetail: () => import('../features/runs/run-detail-page'),
  operations: () => import('../features/operations/operations-page'),
  operationDetail: () => import('../features/operations/operation-detail-page'),
};

export const PasswordPage = lazy(() =>
  loaders.password().then((module) => ({ default: module.PasswordPage })),
);
export const OverviewPage = lazy(() =>
  loaders.overview().then((module) => ({ default: module.OverviewPage })),
);
export const InstancesPage = lazy(() =>
  loaders.instances().then((module) => ({ default: module.InstancesPage })),
);
export const InstanceDetailPage = lazy(() =>
  loaders
    .instanceDetail()
    .then((module) => ({ default: module.InstanceDetailPage })),
);
export const InstanceCreatePage = lazy(() =>
  loaders
    .instanceForm()
    .then((module) => ({ default: module.InstanceCreatePage })),
);
export const InstanceEditPage = lazy(() =>
  loaders
    .instanceForm()
    .then((module) => ({ default: module.InstanceEditPage })),
);
export const JobsPage = lazy(() =>
  loaders.jobs().then((module) => ({ default: module.JobsPage })),
);
export const JobDetailPage = lazy(() =>
  loaders.jobDetail().then((module) => ({ default: module.JobDetailPage })),
);
export const JobCreatePage = lazy(() =>
  loaders.jobForm().then((module) => ({ default: module.JobCreatePage })),
);
export const JobEditPage = lazy(() =>
  loaders.jobForm().then((module) => ({ default: module.JobEditPage })),
);
export const RunsPage = lazy(() =>
  loaders.runs().then((module) => ({ default: module.RunsPage })),
);
export const RunDetailPage = lazy(() =>
  loaders.runDetail().then((module) => ({ default: module.RunDetailPage })),
);
export const OperationsPage = lazy(() =>
  loaders.operations().then((module) => ({ default: module.OperationsPage })),
);
export const OperationDetailPage = lazy(() =>
  loaders
    .operationDetail()
    .then((module) => ({ default: module.OperationDetailPage })),
);

/** 在浏览器空闲时预取全部私有页面分片，加载结果由浏览器模块缓存复用。
 * @returns 取消尚未开始的预取。
 * @throws 不适用；预取失败由实际导航时的页面错误边界报告。
 */
export function prefetchPages(): () => void {
  const run = () => {
    for (const load of Object.values(loaders))
      load().catch(() => {
        // 预取是可选优化；失败留给实际导航的错误边界报告。
      });
  };
  // Safari 尚未提供 requestIdleCallback，退化为短延迟。
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 3000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, 1500);
  return () => clearTimeout(handle);
}
