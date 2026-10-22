// 星图几何：实例在椭圆轨道上的位置、任务光弧路径与空态幽灵节点，纯函数便于测试与复用。
import { instanceHealth } from './status-labels';
import type { InstanceHealth } from './status-labels';
import type { DashboardInstance, DashboardJob } from './dashboard-contract';

/** 画布尺寸与中心（SVG 用户坐标）。 */
export const VIEW = { width: 1200, height: 460, cx: 600, cy: 230 } as const;
/** 外轨道与内轨道半径。 */
export const OUTER = { rx: 430, ry: 158 } as const;
export const INNER = { rx: 290, ry: 104 } as const;

/** 星图节点。 */
export interface VizNode {
  /** 实例 ID。 */
  id: string;
  /** 实例名称。 */
  name: string;
  /** 健康分类，决定颜色。 */
  health: InstanceHealth;
  /** 坐标。 */
  x: number;
  y: number;
}

/** 星图光弧。 */
export interface VizArc {
  /** 稳定键（任务 + 目标序号）。 */
  key: string;
  /** 所属任务。 */
  jobId: string;
  /** 源与目标实例。 */
  from: string;
  to: string;
  /** SVG 路径。 */
  d: string;
  /** 渐变端点，用于从源到目标逐渐变亮。 */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 所属任务最近一次运行失败。 */
  failing: boolean;
}

/** 按序号在椭圆轨道上取点，从左上方开始顺时针排列，节点较多时内外两圈交替。
 * @param index 序号。
 * @param total 总数。
 * @returns 坐标。
 * @throws 不适用。
 */
export function orbitPoint(
  index: number,
  total: number,
): { x: number; y: number } {
  const twoRings = total > 7;
  const ring = twoRings && index % 2 === 1 ? INNER : OUTER;
  const count = twoRings ? Math.ceil(total / 2) : total;
  const slot = twoRings ? Math.floor(index / 2) : index;
  // 内圈错开半格，避免与外圈节点在同一射线上重叠。
  const offset = twoRings && ring === INNER ? Math.PI / count : 0;
  const angle =
    -0.82 * Math.PI + (2 * Math.PI * slot) / Math.max(count, 1) + offset;
  return {
    x: VIEW.cx + ring.rx * Math.cos(angle),
    y: VIEW.cy + ring.ry * Math.sin(angle),
  };
}

/** 计算两节点之间向中心弯曲的二次曲线；同一对节点的多条路径按 lane 错开。
 * @param a 起点。
 * @param b 终点。
 * @param lane 同一对节点上的第几条路径。
 * @returns SVG 路径。
 * @throws 不适用。
 */
function curve(
  a: { x: number; y: number },
  b: { x: number; y: number },
  lane: number,
): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  // 向中心弯曲形成弧线；同一对节点的多条路径交替分布在两侧，间距逐级加大。
  const pull = 0.58;
  const side = lane % 2 === 0 ? 1 : -1;
  const spread = side * Math.ceil(lane / 2) * 58;
  const cx = mx + (VIEW.cx - mx) * pull + nx * spread;
  const cy = my + (VIEW.cy - my) * pull + ny * spread;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** 源与目标是同一实例时画一个沿轨道切向伸出的回环，避开节点上下方的标签。
 * @param a 节点。
 * @param lane 第几条回环。
 * @returns SVG 路径。
 * @throws 不适用。
 */
function loop(a: { x: number; y: number }, lane: number): string {
  const dx = a.x - VIEW.cx;
  const dy = a.y - VIEW.cy;
  const length = Math.hypot(dx, dy) || 1;
  // 径向方向旋转 90°（多条回环交替左右），回环落在节点两侧而不是标签所在的上下方。
  const turn = lane % 2 === 0 ? 1 : -1;
  const ux = (-dy / length) * turn;
  const uy = (dx / length) * turn;
  const reach = 92 + lane * 28;
  const rotate = (angle: number) => ({
    x: a.x + (ux * Math.cos(angle) - uy * Math.sin(angle)) * reach,
    y: a.y + (ux * Math.sin(angle) + uy * Math.cos(angle)) * reach,
  });
  const p1 = rotate(0.62);
  const p2 = rotate(-0.62);
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} ${a.x.toFixed(1)} ${a.y.toFixed(1)}`;
}

/** 生成节点与光弧。
 * @param instances 实例摘要。
 * @param jobs 任务摘要。
 * @param failing 最近一次运行失败的任务 ID。
 * @returns 节点与光弧。
 * @throws 不适用。
 */
export function buildScene(
  instances: DashboardInstance[],
  jobs: DashboardJob[],
  failing: ReadonlySet<string>,
): { nodes: VizNode[]; arcs: VizArc[] } {
  const nodes = instances.map((instance, index) => ({
    id: instance.id,
    name: instance.name,
    health: instanceHealth(instance),
    ...orbitPoint(index, instances.length),
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const lanes = new Map<string, number>();
  const arcs: VizArc[] = [];
  for (const job of jobs) {
    const source = byId.get(job.sourceInstanceId);
    if (!source) continue;
    job.targetInstanceIds.forEach((targetId, position) => {
      const target = byId.get(targetId);
      if (!target) return;
      // 无向配对计数，往返两个方向的路径也会错开。
      const pair = [source.id, target.id].sort().join('|');
      const lane = lanes.get(pair) ?? 0;
      lanes.set(pair, lane + 1);
      const self = source.id === target.id;
      arcs.push({
        key: `${job.id}:${position}`,
        jobId: job.id,
        from: source.id,
        to: target.id,
        d: self ? loop(source, lane) : curve(source, target, lane),
        x1: source.x,
        y1: source.y,
        x2: self ? source.x + 1 : target.x,
        y2: self ? source.y + 1 : target.y,
        failing: failing.has(job.id),
      });
    });
  }
  return { nodes, arcs };
}

/** 外轨道的闭合路径，供卫星沿轨道运动。
 * @param ring 轨道半径。
 * @returns SVG 路径。
 * @throws 不适用。
 */
export function ellipsePath(ring: { rx: number; ry: number }): string {
  const { cx, cy } = VIEW;
  return `M ${cx - ring.rx} ${cy} a ${ring.rx} ${ring.ry} 0 1 0 ${ring.rx * 2} 0 a ${ring.rx} ${ring.ry} 0 1 0 ${-ring.rx * 2} 0`;
}

/** 空态的幽灵节点位置。
 * @returns 五个坐标。
 * @throws 不适用。
 */
export function ghostPoints(): Array<{ x: number; y: number }> {
  return Array.from({ length: 5 }, (_, index) => orbitPoint(index, 5));
}
