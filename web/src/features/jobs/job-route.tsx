// 任务详情的视觉焦点：源节点经发光曲线连向各目标节点，光点沿曲线流动；移动端退化为纵向排列。
import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Badge } from '../../components/ui/badge';
import { useInstanceName } from './job-ui';
import type { JobView } from './job-contract';

// 桌面端目标节点固定高度与间距（像素），连线据此计算端点位置。
const NODE_HEIGHT = 88;
const NODE_GAP = 12;

/** 连线层：按自身实际像素尺寸绘制，曲线和光点都不会被拉伸。
 * @param props count 目标数量。
 * @returns SVG 连线。
 * @throws 不适用。
 */
function Connectors({ count }: { count: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const column = count * NODE_HEIGHT + (count - 1) * NODE_GAP;
  const top = Math.max(0, (height - column) / 2);
  const paths = Array.from({ length: count }, (_, index) => {
    const y = top + index * (NODE_HEIGHT + NODE_GAP) + NODE_HEIGHT / 2;
    const middle = height / 2;
    return `M 0 ${middle} C ${width * 0.55} ${middle}, ${width * 0.45} ${y}, ${width} ${y}`;
  });

  return (
    <div
      ref={box}
      className="relative hidden self-stretch md:block"
      aria-hidden="true"
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="absolute inset-0 overflow-visible"
        >
          <defs>
            <linearGradient id="job-route-stroke" x1="0" x2="1" y1="0" y2="0">
              <stop
                offset="0%"
                stopColor="rgb(185 237 188)"
                stopOpacity="0.7"
              />
              <stop
                offset="100%"
                stopColor="rgb(185 237 188)"
                stopOpacity="0.18"
              />
            </linearGradient>
          </defs>
          {paths.map((path, index) => (
            <g key={index}>
              <path
                d={path}
                fill="none"
                stroke="url(#job-route-stroke)"
                strokeWidth={1}
              />
              {!reduced && (
                <>
                  <circle r={6} fill="rgb(185 237 188)" opacity={0.18}>
                    <animateMotion
                      dur="2.8s"
                      begin={`${index * 0.4}s`}
                      repeatCount="indefinite"
                      path={path}
                    />
                  </circle>
                  <circle r={2.2} fill="rgb(222 255 223)">
                    <animateMotion
                      dur="2.8s"
                      begin={`${index * 0.4}s`}
                      repeatCount="indefinite"
                      path={path}
                    />
                  </circle>
                </>
              )}
            </g>
          ))}
          <circle cx={0} cy={height / 2} r={3.5} fill="rgb(185 237 188)" />
        </svg>
      )}
    </div>
  );
}

/** 渲染源到目标的路径图。
 * @param props job 任务。
 * @returns figure 元素。
 * @throws 不适用。
 */
export function JobRoute({ job }: { job: JobView }) {
  const { t } = useTranslation('jobs');
  const instanceName = useInstanceName();
  const sourceName =
    instanceName(job.source.instanceId) ?? t('detail.unknownInstance');

  return (
    <figure
      aria-label={t('detail.route')}
      className="panel overflow-hidden p-5 sm:p-8"
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(5rem,11rem)_minmax(0,1.25fr)] md:items-center md:gap-0">
        <div className="relative rounded-2xl border border-accent/25 bg-accent/[0.045] p-5 shadow-[0_0_60px_-20px_rgb(185_237_188/0.45)]">
          <p className="eyebrow text-accent">{t('detail.source')}</p>
          <p className="mt-3 font-display text-lg font-medium tracking-tight">
            {sourceName}
          </p>
          <p className="mt-1 font-mono text-[12px] break-all text-muted-foreground">
            {job.source.path}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {job.source.refresh && <Badge plain>{t('detail.refresh')}</Badge>}
          </div>
        </div>
        <Connectors count={job.targets.length} />
        <div
          className="flex justify-center text-accent/70 md:hidden"
          aria-hidden="true"
        >
          <ArrowDown size={18} />
        </div>
        <ol className="space-y-3">
          {job.targets.map((target, index) => (
            <li
              key={target.id}
              className="flex items-center gap-4 rounded-2xl border border-hairline bg-white/[0.02] px-4 py-3 md:h-[5.5rem]"
            >
              <span className="font-mono text-[11px] text-accent">
                {`T${String(index + 1).padStart(2, '0')}`}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {instanceName(target.instanceId) ??
                    t('detail.unknownInstance')}
                </span>
                <span className="mt-1 block truncate font-mono text-[11.5px] text-muted-foreground">
                  {target.path}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Badge
                  plain
                  variant={target.mode === 'mirror' ? 'warning' : 'default'}
                >
                  {t(`mode.${target.mode}`)}
                </Badge>
                <Badge plain variant="info">
                  {t(`createMode.${target.createMode}`)}
                </Badge>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
