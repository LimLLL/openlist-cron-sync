// 签名星图：实例是轨道上的发光节点，任务是从源流向目标的光弧；悬停高亮关联路径，空态呈现装饰性轨道。
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { StatusDot } from '../../components/ui/status-dot';
import {
  buildScene,
  ellipsePath,
  ghostPoints,
  INNER,
  OUTER,
  VIEW,
} from './viz-geometry';
import type { InstanceHealth } from './status-labels';
import type { DashboardInstance, DashboardJob } from './dashboard-contract';

const COLORS: Record<InstanceHealth, string> = {
  ready: '#b9edbc',
  blocked: '#e2ae73',
  error: '#f4a39b',
  untested: '#8b958d',
};
const FAILING = '#f4a39b';
const TICKS = Array.from({ length: 12 }, (_, index) => index * 30);
const STATE_KEY = {
  ready: 'stateReady',
  blocked: 'stateBlocked',
  error: 'stateError',
  untested: 'stateUntested',
} as const;

/** 星图属性。 */
interface ObservatoryVizProps {
  /** 已加载的实例。 */
  instances: DashboardInstance[];
  /** 已加载的任务。 */
  jobs: DashboardJob[];
  /** 最近一次运行失败的任务 ID。 */
  failing: ReadonlySet<string>;
}

/** 渲染星图；整体是装饰，同样的信息在页面下方的列表中可通过键盘访问。
 * @param props 实例、任务与失败任务集合。
 * @returns 星图区域。
 * @throws 不适用。
 */
export function ObservatoryViz({
  instances,
  jobs,
  failing,
}: ObservatoryVizProps) {
  const { t } = useTranslation('dashboard');
  const reduced = useReducedMotion() ?? false;
  const navigate = useNavigate();
  const uid = useId().replace(/:/g, '');
  const [hovered, setHovered] = useState<string | null>(null);
  const { nodes, arcs } = useMemo(
    () => buildScene(instances, jobs, failing),
    [instances, jobs, failing],
  );
  const empty = nodes.length === 0;
  const orbit = ellipsePath(OUTER);
  const inner = ellipsePath(INNER);

  /** 悬停时只保留与该节点相连的路径与节点。
   * @param ids 路径两端的节点 ID。
   * @returns 是否淡出。
   * @throws 不适用。
   */
  const dimmed = (ids: string[]) => hovered !== null && !ids.includes(hovered);
  const linked = new Set(
    hovered
      ? arcs
          .filter((arc) => arc.from === hovered || arc.to === hovered)
          .flatMap((arc) => [arc.from, arc.to])
      : [],
  );

  return (
    <div
      aria-hidden="true"
      className="relative -mx-5 aspect-[1200/520] select-none sm:-mx-9 sm:aspect-auto sm:h-[28rem] lg:-mx-14 lg:-mt-12 lg:h-[32rem]"
      style={{
        maskImage:
          'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        WebkitMaskImage:
          'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
      }}
    >
      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id={`${uid}-core`}>
            <stop offset="0%" stopColor="#b9edbc" stopOpacity="0.28" />
            <stop offset="55%" stopColor="#b9edbc" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#b9edbc" stopOpacity="0" />
          </radialGradient>
          {(Object.keys(COLORS) as InstanceHealth[]).map((health) => (
            <radialGradient key={health} id={`${uid}-halo-${health}`}>
              <stop offset="0%" stopColor={COLORS[health]} stopOpacity="0.32" />
              <stop offset="100%" stopColor={COLORS[health]} stopOpacity="0" />
            </radialGradient>
          ))}
          {arcs.map((arc) => (
            <linearGradient
              key={arc.key}
              id={`${uid}-arc-${arc.key.replace(/[^a-z0-9]/gi, '')}`}
              gradientUnits="userSpaceOnUse"
              x1={arc.x1}
              y1={arc.y1}
              x2={arc.x2}
              y2={arc.y2}
            >
              <stop
                offset="0%"
                stopColor={arc.failing ? FAILING : '#b9edbc'}
                stopOpacity="0.08"
              />
              <stop
                offset="100%"
                stopColor={arc.failing ? FAILING : '#d6f7d7'}
                stopOpacity="0.95"
              />
            </linearGradient>
          ))}
          <filter
            id={`${uid}-blur`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <path id={`${uid}-orbit`} d={orbit} />
          <path id={`${uid}-inner`} d={inner} />
        </defs>

        {/* 轨道、刻度与外圈缓慢旋转的虚线 */}
        <g fill="none" stroke="#b9edbc">
          <ellipse
            cx={VIEW.cx}
            cy={VIEW.cy}
            rx={OUTER.rx + 90}
            ry={OUTER.ry + 34}
            strokeOpacity="0.04"
          />
          <ellipse
            cx={VIEW.cx}
            cy={VIEW.cy}
            rx={OUTER.rx}
            ry={OUTER.ry}
            strokeOpacity="0.11"
          />
          <ellipse
            cx={VIEW.cx}
            cy={VIEW.cy}
            rx={INNER.rx}
            ry={INNER.ry}
            strokeOpacity="0.06"
            strokeDasharray="3 7"
          />
          <ellipse
            cx={VIEW.cx}
            cy={VIEW.cy}
            rx={150}
            ry={54}
            strokeOpacity="0.05"
          />
          <ellipse
            cx={VIEW.cx}
            cy={VIEW.cy}
            rx={OUTER.rx + 44}
            ry={OUTER.ry + 18}
            strokeOpacity="0.09"
            strokeDasharray="1 10"
            style={{
              transformOrigin: `${VIEW.cx}px ${VIEW.cy}px`,
              transformBox: 'view-box',
              animation: 'orbit-spin 220s linear infinite',
            }}
          />
        </g>
        {TICKS.map((degree) => {
          const angle = (degree * Math.PI) / 180;
          const x = VIEW.cx + (OUTER.rx + 66) * Math.cos(angle);
          const y = VIEW.cy + (OUTER.ry + 26) * Math.sin(angle);
          return (
            <text
              key={degree}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground font-mono"
              fontSize="9"
              opacity="0.3"
            >
              {String(degree).padStart(3, '0')}°
            </text>
          );
        })}

        {/* 沿轨道运行的卫星 */}
        {!reduced &&
          [0, 0.33, 0.66].map((phase, index) => (
            <circle
              key={phase}
              r={index === 1 ? 1.8 : 1.3}
              fill={index === 2 ? '#e2ae73' : '#cdf0cf'}
              opacity="0.75"
            >
              <animateMotion
                dur={`${46 + index * 18}s`}
                repeatCount="indefinite"
                begin={`-${phase * 46}s`}
              >
                <mpath
                  href={`#${uid}-${index === 1 ? 'inner' : 'orbit'}`}
                  xlinkHref={`#${uid}-${index === 1 ? 'inner' : 'orbit'}`}
                />
              </animateMotion>
            </circle>
          ))}

        {/* 中心：同步引擎 */}
        <circle cx={VIEW.cx} cy={VIEW.cy} r="120" fill={`url(#${uid}-core)`} />
        <circle
          cx={VIEW.cx}
          cy={VIEW.cy}
          r="26"
          fill="#0d110e"
          stroke="#b9edbc"
          strokeOpacity="0.32"
        />
        <circle
          cx={VIEW.cx}
          cy={VIEW.cy}
          r="38"
          fill="none"
          stroke="#b9edbc"
          strokeOpacity="0.1"
          strokeDasharray="2 5"
        />
        <circle cx={VIEW.cx} cy={VIEW.cy} r="5" fill="#b9edbc" />
        {!reduced && (
          <circle
            cx={VIEW.cx}
            cy={VIEW.cy}
            r="26"
            fill="none"
            stroke="#b9edbc"
            strokeOpacity="0.4"
          >
            <animate
              attributeName="r"
              values="26;54"
              dur="3.6s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="stroke-opacity"
              values="0.4;0"
              dur="3.6s"
              repeatCount="indefinite"
            />
          </circle>
        )}
        <text
          x={VIEW.cx}
          y={VIEW.cy + 58}
          textAnchor="middle"
          className="fill-muted-foreground font-mono"
          fontSize="10"
          letterSpacing="2"
          opacity="0.55"
        >
          {t('viz.engine')}
        </text>

        {/* 空态：幽灵节点与虚线弧 */}
        {empty &&
          ghostPoints().map((point, index, all) => {
            const next = all[(index + 2) % all.length];
            return (
              <g key={index}>
                <path
                  d={`M ${point.x} ${point.y} Q ${VIEW.cx} ${VIEW.cy} ${next.x} ${next.y}`}
                  fill="none"
                  stroke="#b9edbc"
                  strokeOpacity="0.07"
                  strokeDasharray="2 8"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="14"
                  fill="none"
                  stroke="#8b958d"
                  strokeOpacity="0.28"
                  strokeDasharray="2 4"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="2.5"
                  fill="#8b958d"
                  opacity="0.45"
                />
              </g>
            );
          })}

        {/* 任务光弧：辉光底层 + 渐变主线 + 流动虚线 + 数据包 */}
        {arcs.map((arc) => {
          const gradient = `url(#${uid}-arc-${arc.key.replace(/[^a-z0-9]/gi, '')})`;
          const pathId = `${uid}-path-${arc.key.replace(/[^a-z0-9]/gi, '')}`;
          const faded = dimmed([arc.from, arc.to]);
          return (
            <g
              key={arc.key}
              opacity={faded ? 0.12 : 1}
              style={{ transition: 'opacity 300ms ease' }}
            >
              <path
                d={arc.d}
                fill="none"
                stroke={gradient}
                strokeWidth="7"
                opacity="0.35"
                filter={`url(#${uid}-blur)`}
              />
              <path
                id={pathId}
                d={arc.d}
                fill="none"
                stroke={gradient}
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              {!reduced && (
                <>
                  <path
                    d={arc.d}
                    fill="none"
                    stroke={arc.failing ? FAILING : '#effff0'}
                    strokeOpacity="0.55"
                    strokeWidth="1.2"
                    strokeDasharray="1 16"
                    strokeLinecap="round"
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="0"
                      to="-34"
                      dur="1.6s"
                      repeatCount="indefinite"
                    />
                  </path>
                  <circle r="3.2" fill={arc.failing ? FAILING : '#effff0'}>
                    <animateMotion
                      dur="3.4s"
                      repeatCount="indefinite"
                      rotate="auto"
                    >
                      <mpath href={`#${pathId}`} xlinkHref={`#${pathId}`} />
                    </animateMotion>
                  </circle>
                </>
              )}
            </g>
          );
        })}

        {/* 实例节点 */}
        {nodes.map((node) => {
          const color = COLORS[node.health];
          const below = node.y >= VIEW.cy;
          const faded =
            hovered !== null && hovered !== node.id && !linked.has(node.id);
          return (
            <g
              key={node.id}
              opacity={faded ? 0.25 : 1}
              style={{ transition: 'opacity 300ms ease', cursor: 'pointer' }}
              onPointerEnter={() => setHovered(node.id)}
              onPointerLeave={() => setHovered(null)}
              onClick={() => void navigate(`/instances/${node.id}`)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r="48"
                fill={`url(#${uid}-halo-${node.health})`}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r="15"
                fill="#0b0e0c"
                stroke={color}
                strokeOpacity="0.45"
              />
              <circle cx={node.x} cy={node.y} r="5.5" fill={color} />
              {!reduced && node.health !== 'untested' && (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="15"
                  fill="none"
                  stroke={color}
                >
                  <animate
                    attributeName="r"
                    values="15;34"
                    dur="2.8s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="stroke-opacity"
                    values="0.5;0"
                    dur="2.8s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <circle cx={node.x} cy={node.y} r="40" fill="transparent" />
              <text
                x={node.x}
                y={below ? node.y + 40 : node.y - 44}
                textAnchor="middle"
                className="fill-foreground font-display"
                fontSize="16"
                fontWeight="500"
              >
                {[...node.name].length > 22
                  ? `${[...node.name].slice(0, 21).join('')}…`
                  : node.name}
              </text>
              <text
                x={node.x}
                y={below ? node.y + 58 : node.y - 26}
                textAnchor="middle"
                className="font-mono"
                fontSize="10"
                letterSpacing="1.5"
                fill={color}
                opacity="0.8"
              >
                {t(`viz.${STATE_KEY[node.health]}`)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* 左上角说明与右下角图例 */}
      <div className="pointer-events-none absolute top-4 left-5 sm:left-9 lg:left-14">
        <p className="eyebrow">{t('viz.caption')}</p>
        {!empty && (
          <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
            {t('viz.summary', { nodes: nodes.length, paths: arcs.length })}
          </p>
        )}
      </div>
      {empty ? (
        <div className="pointer-events-none absolute bottom-6 left-5 max-w-sm sm:left-9 lg:left-14">
          <p className="serif-accent text-3xl">{t('viz.emptyTitle')}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t('viz.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="pointer-events-none absolute right-5 bottom-5 hidden flex-wrap items-center justify-end gap-x-4 gap-y-2 font-mono text-[10.5px] text-muted-foreground sm:flex sm:right-9 lg:right-14">
          <span className="flex items-center gap-1.5">
            <StatusDot tone="success" />
            {t('viz.legendReady')}
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot tone="warning" />
            {t('viz.legendBlocked')}
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot tone="danger" />
            {t('viz.legendError')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-px w-5 bg-gradient-to-r from-accent/10 to-accent" />
            {t('viz.legendPath')}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-px w-5 bg-gradient-to-r from-danger/10 to-danger" />
            {t('viz.legendFailing')}
          </span>
        </div>
      )}
    </div>
  );
}
