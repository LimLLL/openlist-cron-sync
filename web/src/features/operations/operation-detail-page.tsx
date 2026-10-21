// 操作详情页：编辑式页头、路径档案与统计、生命周期、记录、处置结果，以及未知结果的处置表单。
import { ArrowLeft, ArrowUpRight, Folder } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page-header';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EditorialSection } from '../../components/ui/editorial-section';
import { ErrorState, LoadingState } from '../../components/states';
import { useOperationDetail } from './operation-queries';
import type { OperationView } from './operation-contract';
import { OperationStats, PathDossier } from './operation-dossier';
import { UnknownManagement } from './operation-manage';
import { OperationError, OperationFacts, OperationTimeline, ResolutionBlock } from './operation-record';
import { splitPath, statusBadge } from './operation-status';

/** 渲染页头描述区的标签组：状态、动作、方式、原因与是否目录。
 * @param props op 操作视图。
 * @returns 标签组。
 * @throws 不适用。
 */
function HeaderTags({ op }: { op: OperationView }) {
  const { t } = useTranslation(['operations', 'common']);
  const badge = statusBadge(op.status);
  // 译文按当前语言比较，类型上统一为 string。
  const action: string = t(`common:operationAction.${op.action}`);
  const method: string = t(`common:operationMethod.${op.method}`);
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant={badge.variant} pulse={badge.pulse}>
        {t(`common:operationStatus.${op.status}`)}
      </Badge>
      <Badge plain>{action}</Badge>
      {/* 中文里 mkdir 的动作与方式同名，相同时只显示一次。 */}
      {method !== action && <Badge plain>{method}</Badge>}
      <Badge plain>{t(`common:operationReason.${op.reason}`)}</Badge>
      {op.isDir && op.action !== 'mkdir' && (
        <Badge plain variant="info">
          <Folder size={11} aria-hidden="true" />
          {t('detail.directory')}
        </Badge>
      )}
    </div>
  );
}

/** 渲染操作详情页。
 * @returns 详情页或加载/错误状态。
 * @throws 不适用。
 */
export function OperationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const op = useOperationDetail(id!);
  const { t } = useTranslation(['operations', 'common']);

  if (op.isPending) return <LoadingState label={t('detail.loading')} rows={8} />;
  if (op.isError) return <ErrorState error={op.error} onRetry={() => void op.refetch()} />;

  const detail = op.data;
  const { name } = splitPath(detail.targetPath);
  const showManage = detail.status === 'unknown' && !detail.resolution;
  // 分节编号随可选分节顺延：生命周期、记录固定为 01、02。
  let next = 3;
  const resolutionIndex = detail.resolution ? String(next++).padStart(2, '0') : null;

  return (
    <section>
      <PageHeader
        index="05"
        kicker={t('common:nav.operations')}
        variant="detail"
        title={name || t('detail.title')}
        meta={
          <Link to="/operations" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft size={12} aria-hidden="true" />
            {t('detail.back')}
          </Link>
        }
        description={<HeaderTags op={detail} />}
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link to={`/runs/${detail.runId}`}>
              {t('detail.viewRun')}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </Button>
        }
      />
      {detail.error && <OperationError error={detail.error} />}
      <PathDossier op={detail} />
      <OperationStats op={detail} />
      <EditorialSection
        index="01"
        title={t('detail.lifecycle.title')}
        description={t('detail.lifecycle.description')}
      >
        <OperationTimeline op={detail} />
      </EditorialSection>
      <EditorialSection
        index="02"
        title={t('detail.record.title')}
        description={t('detail.record.description')}
      >
        <OperationFacts op={detail} />
      </EditorialSection>
      {detail.resolution && resolutionIndex && (
        <EditorialSection
          index={resolutionIndex}
          title={t('detail.resolution.title')}
          description={t('detail.resolution.description')}
        >
          <ResolutionBlock resolution={detail.resolution} />
        </EditorialSection>
      )}
      {showManage && <UnknownManagement op={detail} firstIndex={next} />}
    </section>
  );
}
