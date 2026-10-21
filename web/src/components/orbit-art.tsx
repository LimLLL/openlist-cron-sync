// 以 CSS 绘制观测轨道，作为装饰而非承载真实同步数据的图表。
import { Orbit } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** 渲染对辅助技术隐藏的静态轨道艺术层。
 * @returns 装饰轨道，不发起网络请求或模拟业务指标。
 * @throws 不适用。
 */
export function OrbitArt() {
  const { t } = useTranslation('auth');
  return (
    <div className="orbit-art" aria-hidden="true">
      <div className="orbit-ring orbit-ring-outer" />
      <div className="orbit-ring orbit-ring-middle" />
      <div className="orbit-ring orbit-ring-inner" />
      <div className="orbit-axis" />
      <div className="orbit-core">
        <Orbit size={38} strokeWidth={1} />
      </div>
      <span className="orbit-point orbit-point-one" />
      <span className="orbit-point orbit-point-two" />
      <span className="orbit-caption">{t('login.sourceDestination')}</span>
    </div>
  );
}
