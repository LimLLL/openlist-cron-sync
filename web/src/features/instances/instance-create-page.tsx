// 实例创建页：编辑式页头加分节表单，顶栏的保存按钮通过表单 id 提交。
import { ArrowLeft, LoaderCircle, Save } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/page-header';
import { Magnetic } from '../../components/motion/magnetic';
import { Button } from '../../components/ui/button';
import { useCreateInstance } from './instance-queries';
import { InstanceForm } from './instance-form';

const FORM_ID = 'instance-create-form';

/** 渲染实例创建页面。
 * @returns 创建表单页。
 * @throws 不适用。
 */
export function InstanceCreatePage() {
  const { t } = useTranslation(['instances', 'common']);
  const mutation = useCreateInstance();
  return (
    <section>
      <PageHeader
        index="02"
        kicker={t('common:nav.instances')}
        description={t('create.description')}
        meta={
          <Link to="/instances" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <ArrowLeft size={12} aria-hidden="true" />
            {t('create.back')}
          </Link>
        }
        actions={
          <Magnetic>
            <Button type="submit" form={FORM_ID} size="sm" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <LoaderCircle size={15} className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Save size={15} aria-hidden="true" />
              )}
              {t('form.create')}
            </Button>
          </Magnetic>
        }
      />
      <InstanceForm
        formId={FORM_ID}
        onSubmit={(data) => mutation.mutate(data)}
        pending={mutation.isPending}
        error={mutation.error}
      />
    </section>
  );
}
