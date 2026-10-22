// 编号列表：发丝线分隔、整行可点击；悬停时柔光跟随指针、标题右移、箭头滑入，入场逐行错落。
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils';

const EASE = [0.16, 1, 0.3, 1] as const;

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

/** 生成桌面端列定义：编号、标题、若干等宽信息列、状态、箭头。
 * @param cellCount 信息列数量。
 * @returns grid-template-columns 值。
 * @throws 不适用。
 */
export function indexColumns(cellCount: number): string {
  const cells = Array.from({ length: cellCount }, () => 'minmax(0, 1fr)').join(
    ' ',
  );
  // 每行是独立 grid，状态列必须定宽，否则标签宽度不同会让各行列线错位。
  return `2.75rem minmax(0, 1.7fr) ${cells} 9rem 1.25rem`;
}

/** 渲染列表容器，子项依次入场。
 * @param props children 列表项；className 附加样式。
 * @returns 无序列表。
 * @throws 不适用。
 */
export function IndexList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.ul
      className={className}
      variants={listVariants}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.ul>
  );
}

/** 渲染与行对齐的列标题，仅桌面端显示信息列。
 * @param props title 标题列名；cells 信息列名；status 状态列名。
 * @returns 列标题行。
 * @throws 不适用。
 */
export function IndexHead({
  title,
  cells = [],
  status,
}: {
  title: ReactNode;
  cells?: ReactNode[];
  status?: ReactNode;
}) {
  return (
    <div
      className="index-head eyebrow"
      style={{ '--cols': indexColumns(cells.length) } as CSSProperties}
      aria-hidden="true"
    >
      <span>#</span>
      <span>{title}</span>
      {cells.map((cell, position) => (
        <span key={position} className="index-head-cell">
          {cell}
        </span>
      ))}
      <span>{status}</span>
    </div>
  );
}

/** 编号行属性。 */
interface IndexRowProps {
  /** 目标路由。 */
  to: string;
  /** 从 1 开始的序号，显示为两位数。 */
  index: number;
  /** 主标题。 */
  title: ReactNode;
  /** 标题下方的等宽副信息（如路径、ID）。 */
  subtitle?: ReactNode;
  /** 桌面端的信息列，数量需与 IndexHead 一致。 */
  cells?: ReactNode[];
  /** 右侧状态（通常是 Badge）。 */
  status?: ReactNode;
  /** 附加样式。 */
  className?: string;
}

/** 把指针位置写入 CSS 变量，驱动柔光跟随。
 * @param event 指针事件。
 * @returns 不适用。
 * @throws 不适用。
 */
function trackPointer(event: PointerEvent<HTMLAnchorElement>): void {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    '--mx',
    `${event.clientX - rect.left}px`,
  );
  event.currentTarget.style.setProperty(
    '--my',
    `${event.clientY - rect.top}px`,
  );
}

/** 渲染一行可点击的编号条目。
 * @param props 行内容与目标路由。
 * @returns 列表项。
 * @throws 不适用。
 */
export function IndexRow({
  to,
  index,
  title,
  subtitle,
  cells = [],
  status,
  className,
}: IndexRowProps) {
  return (
    <motion.li variants={itemVariants}>
      <Link
        to={to}
        className={cn('index-row', className)}
        style={{ '--cols': indexColumns(cells.length) } as CSSProperties}
        onPointerMove={trackPointer}
      >
        <span className="index-row-number">
          {String(index).padStart(2, '0')}
        </span>
        <span className="min-w-0">
          <span className="index-row-title block truncate">{title}</span>
          {subtitle && (
            <span className="mt-1 block truncate font-mono text-[11.5px] text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
        {cells.map((cell, position) => (
          <span key={position} className="index-row-cell">
            {cell}
          </span>
        ))}
        <span className="flex justify-end md:justify-start">{status}</span>
        <ArrowUpRight
          size={16}
          className="index-row-arrow"
          aria-hidden="true"
        />
      </Link>
    </motion.li>
  );
}
