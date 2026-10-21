// 实例详情页：详情页头与顶栏操作（测试、浏览、编辑、归档），在只读视图与编辑表单之间切换。
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { motion } from 'framer-motion';
import { Trans, useTranslation } from 'react-i18next';
import {
  Archive,
  ArrowLeft,
  FolderSearch,
  LoaderCircle,
  Pencil,
  Plug,
  Save,
} from 'lucide-react';
import { PageHeader } from '../../components/page-header';
import { Magnetic } from '../../components/motion/magnetic';
import { ScrambleText } from '../../components/motion/scramble-text';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '../../components/states';
import {
  useArchiveInstance,
  useInstance,
  useInstanceTest,
  useUpdateInstance,
} from './instance-queries';
import { InstanceForm } from './instance-form';
import { InstanceDetailView } from './instance-detail-view';
import { InstanceBrowseDialog } from './instance-browse-dialog';
import type { Instance } from './instance-contract';

const EDIT_FORM_ID = 'instance-edit-form';
const EASE = [0.16, 1, 0.3, 1] as const;

/** 渲染实例详情页。
 * @returns 实例详情或加载/错误状态。
 * @throws 不适用。
 */
export function InstanceDetailPage() {
  const { t } = useTranslation(['instances', 'common']);
  const { id } = useParams<{ id: string }>();
  const query = useInstance(id!);

  if (query.isPending) return <LoadingState label={t('detail.loading')} rows={6} />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  return <InstanceDetail instance={query.data} />;
}

/** 渲染已加载实例的详情；测试 mutation 在此持有，顶栏按钮与结果面板共享。
 * @param props instance 实例。
 * @returns 详情页内容。
 * @throws 不适用。
 */
function InstanceDetail({ instance }: { instance: Instance }) {
  const { t } = useTranslation(['instances', 'common']);
  const [editing, setEditing] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const test = useInstanceTest(instance.id);
  const update = useUpdateInstance(instance.id);
  const archive = useArchiveInstance();
  const blocked = instance.authState === 'auth_blocked';

  const viewActions = (
    <>
      <Magnetic>
        <Button size="sm" onClick={() => test.mutate(blocked)} disabled={test.isPending}>
          {test.isPending ? (
            <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Plug size={15} aria-hidden="true" />
          )}
          {test.isPending ? t('detail.testing') : blocked ? t('detail.retryAuth') : t('detail.test')}
        </Button>
      </Magnetic>
      <Button size="sm" variant="secondary" onClick={() => setBrowseOpen(true)}>
        <FolderSearch size={15} aria-hidden="true" />
        {t('detail.browse')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        <Pencil size={14} aria-hidden="true" />
        {t('detail.edit')}
      </Button>
      <Button
        size="icon"
        variant="danger"
        className="size-9"
        onClick={() => setArchiveOpen(true)}
        aria-label={t('common:actions.archive')}
        title={t('common:actions.archive')}
      >
        <Archive size={15} aria-hidden="true" />
      </Button>
    </>
  );

  const editActions = (
    <>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={update.isPending}>
        {t('common:actions.cancel')}
      </Button>
      <Magnetic>
        <Button size="sm" type="submit" form={EDIT_FORM_ID} disabled={update.isPending}>
          {update.isPending ? (
            <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Save size={15} aria-hidden="true" />
          )}
          {t('form.save')}
        </Button>
      </Magnetic>
    </>
  );

  return (
    <section>
      <PageHeader
        index="02"
        kicker={t('common:nav.instances')}
        title={instance.name}
        description={
          <div className="space-y-2">
            <p className="font-mono text-[13px] break-all text-foreground/80">{instance.baseUrl}</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              ID <ScrambleText text={instance.id} playOnMount />
            </p>
          </div>
        }
        meta={
          <Link to="/instances" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft size={12} aria-hidden="true" />
            {t('detail.back')}
          </Link>
        }
        actions={editing ? editActions : viewActions}
      />

      {editing ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <p className="mb-2 flex items-center gap-2 text-sm text-foreground">
            <Pencil size={14} className="text-accent" aria-hidden="true" />
            {t('detail.editing')}
          </p>
          <p className="mb-6 text-[13px] text-muted-foreground">{t('detail.editHint')}</p>
          <InstanceForm
            formId={EDIT_FORM_ID}
            instance={instance}
            onSubmit={(data) => update.mutate(data, { onSuccess: () => setEditing(false) })}
            onCancel={() => setEditing(false)}
            pending={update.isPending}
            error={update.error}
          />
        </motion.div>
      ) : (
        <InstanceDetailView instance={instance} test={test} />
      )}

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t('detail.archiveTitle')}
        description={
          <Trans
            t={t}
            i18nKey="detail.archiveDescription"
            values={{ name: instance.name }}
            components={{ strong: <strong className="text-foreground" /> }}
          />
        }
        confirmLabel={t('common:actions.archive')}
        onConfirm={() => archive.mutate(instance.id)}
        pending={archive.isPending}
        error={archive.error}
      />

      {browseOpen && (
        <InstanceBrowseDialog
          instanceId={instance.id}
          instanceName={instance.name}
          open={browseOpen}
          onOpenChange={setBrowseOpen}
        />
      )}
    </section>
  );
}
