// 首次使用引导：三个大号编号步骤，从连接实例到预览运行，每一步都是可点击的整行。
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const EASE = [0.16, 1, 0.3, 1] as const;

/** 渲染三步引导；复用编号行的悬停柔光与箭头动效。
 * @param props hasInstances 是否已有实例（已有时第一步视为完成）。
 * @returns 有序列表。
 * @throws 不适用。
 */
export function Onboarding({ hasInstances }: { hasInstances: boolean }) {
  const { t } = useTranslation('dashboard');
  const steps = [
    {
      title: t('onboarding.step1'),
      body: t('onboarding.step1Body'),
      to: '/instances/new',
      done: hasInstances,
    },
    {
      title: t('onboarding.step2'),
      body: t('onboarding.step2Body'),
      to: '/jobs/new',
      done: false,
    },
    {
      title: t('onboarding.step3'),
      body: t('onboarding.step3Body'),
      to: '/jobs',
      done: false,
    },
  ];
  return (
    <ol className="border-t border-hairline">
      {steps.map((step, position) => (
        <motion.li
          key={step.to}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.7,
            ease: EASE,
            delay: 0.1 + position * 0.08,
          }}
        >
          <Link
            to={step.to}
            className="index-row grid-cols-[3.5rem_minmax(0,1fr)_auto] py-7 md:grid-cols-[5rem_minmax(0,1fr)_1.25rem]"
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              event.currentTarget.style.setProperty(
                '--mx',
                `${event.clientX - rect.left}px`,
              );
              event.currentTarget.style.setProperty(
                '--my',
                `${event.clientY - rect.top}px`,
              );
            }}
          >
            <span
              className={`serif-accent text-4xl leading-none sm:text-5xl ${step.done ? 'text-accent' : 'text-muted-foreground'}`}
            >
              {String(position + 1).padStart(2, '0')}
            </span>
            <span className="min-w-0">
              <span className="index-row-title block text-xl sm:text-2xl">
                {step.title}
              </span>
              <span className="mt-2 block max-w-xl text-sm leading-6 text-muted-foreground">
                {step.body}
              </span>
            </span>
            <ArrowUpRight
              size={18}
              className="index-row-arrow"
              aria-hidden="true"
            />
          </Link>
        </motion.li>
      ))}
    </ol>
  );
}
