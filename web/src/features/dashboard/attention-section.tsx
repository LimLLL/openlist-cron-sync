// 需要关注：近期失败/部分成功的运行，以编号行列出，空时给出明确的“一切正常”。
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { IndexHead, IndexList, IndexRow } from '../../components/ui/index-list';
import { StatusDot } from '../../components/ui/status-dot';
import { useErrorText } from '../../i18n/error-text';
import { formatRelative, formatTime } from '../../lib/format';
import { runTone, useStatusLabels } from './status-labels';
import type { DashboardRun } from './dashboard-contract';

/** 关注区域属性。 */
interface AttentionSectionProps {
  /** 近期失败或部分完成的运行。 */
  failedRuns: DashboardRun[];
  /** 任务 ID 到名称的映射，归档任务不在其中。 */
  jobNames: ReadonlyMap<string, string>;
}

/** 渲染需要管理员处理的事项。
 * @param props 失败运行与任务名称。
 * @returns 列表或“一切正常”。
 * @throws 不适用。
 */
export function AttentionSection({
  failedRuns,
  jobNames,
}: AttentionSectionProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const errorText = useErrorText();
  const labels = useStatusLabels();

  if (failedRuns.length === 0)
    return (
      <p className="flex items-center gap-3 border-y border-hairline px-1 py-6 text-sm text-muted-foreground">
        <StatusDot tone="success" />
        {t('attention.empty')}
      </p>
    );

  return (
    <div>
      <IndexHead
        title={t('attention.columns.item')}
        cells={[t('attention.columns.kind'), t('attention.columns.when')]}
        status={t('attention.columns.state')}
      />
      <IndexList>
        {failedRuns.map((run, position) => (
          <IndexRow
            key={run.id}
            to={`/runs/${run.id}`}
            index={position + 1}
            title={jobNames.get(run.jobId) ?? t('activity.unknownJob')}
            subtitle={
              run.error
                ? errorText(run.error.code, run.error.message)
                : `${run.id.slice(0, 8)} · ${formatTime(run.endedAt ?? run.createdAt)}`
            }
            cells={[
              run.dryRun
                ? `${t('attention.kindRun')} · ${t('common:dryRun')}`
                : t('attention.kindRun'),
              formatRelative(run.endedAt ?? run.createdAt),
            ]}
            status={
              <Badge variant={runTone(run.status)}>
                {labels.run(run.status)}
              </Badge>
            }
          />
        ))}
      </IndexList>
    </div>
  );
}
