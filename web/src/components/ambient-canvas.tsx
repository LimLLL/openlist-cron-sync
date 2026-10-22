// 全屏固定的星尘画布：粒子缓慢漂移，指针附近受引力偏转并连成星座；后台暂停，减弱动效时只画静态一帧。
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

// 每平方像素的粒子密度与上限，保证大屏也只有一百多个粒子。
const DENSITY = 1 / 13000;
const MAX_PARTICLES = 170;
// 指针引力半径与星座连线距离（CSS 像素）。
const POINTER_RADIUS = 200;
const LINK_DISTANCE = 96;

/** 单个星尘粒子。 */
interface Particle {
  /** 位置。 */
  x: number;
  y: number;
  /** 速度。 */
  vx: number;
  vy: number;
  /** 半径。 */
  r: number;
  /** 基础透明度。 */
  alpha: number;
  /** 少量琥珀色粒子与主题的信号色呼应。 */
  amber: boolean;
}

/** 生成随机粒子。
 * @param width 画布宽度。
 * @param height 画布高度。
 * @returns 新粒子。
 * @throws 不适用。
 */
function spawn(width: number, height: number): Particle {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.12,
    vy: (Math.random() - 0.5) * 0.12,
    r: Math.random() * 1.1 + 0.25,
    alpha: Math.random() * 0.45 + 0.15,
    amber: Math.random() < 0.06,
  };
}

/** 渲染位于所有内容之下的装饰画布，不响应指针事件、不进入无障碍树。
 * @returns canvas 元素。
 * @throws 不适用。
 */
export function AmbientCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let width = 0;
    let height = 0;
    let frame = 0;
    let particles: Particle[] = [];
    const pointer = { x: -9999, y: -9999 };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(
        MAX_PARTICLES,
        Math.round(width * height * DENSITY),
      );
      particles = Array.from({ length: count }, () => spawn(width, height));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const near: Particle[] = [];
      for (const particle of particles) {
        const dx = pointer.x - particle.x;
        const dy = pointer.y - particle.y;
        const distance = Math.hypot(dx, dy);
        if (!reduced && distance < POINTER_RADIUS && distance > 1) {
          // 线性衰减的弱引力，配合阻尼让粒子绕指针缓慢聚拢而不是直接吸附。
          const pull = (1 - distance / POINTER_RADIUS) * 0.012;
          particle.vx += (dx / distance) * pull;
          particle.vy += (dy / distance) * pull;
          near.push(particle);
        }
        particle.vx *= 0.985;
        particle.vy *= 0.985;
        particle.x += particle.vx + 0.02;
        particle.y += particle.vy;
        // 越界从对侧回到画面，保持密度恒定。
        if (particle.x < -10) particle.x = width + 10;
        if (particle.x > width + 10) particle.x = -10;
        if (particle.y < -10) particle.y = height + 10;
        if (particle.y > height + 10) particle.y = -10;
        const glow =
          distance < POINTER_RADIUS ? (1 - distance / POINTER_RADIUS) * 0.5 : 0;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.r + glow, 0, Math.PI * 2);
        context.fillStyle = particle.amber
          ? `rgba(226, 174, 115, ${particle.alpha + glow})`
          : `rgba(205, 240, 207, ${particle.alpha + glow})`;
        context.fill();
      }
      // 只在指针附近的粒子之间连线，星座随指针出现。
      context.lineWidth = 0.6;
      for (let i = 0; i < near.length; i += 1) {
        for (let j = i + 1; j < near.length; j += 1) {
          const a = near[i];
          const b = near[j];
          const gap = Math.hypot(a.x - b.x, a.y - b.y);
          if (gap > LINK_DISTANCE) continue;
          context.strokeStyle = `rgba(185, 237, 188, ${(1 - gap / LINK_DISTANCE) * 0.28})`;
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
    };

    const loop = () => {
      draw();
      frame = window.requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced || frame || document.hidden) return;
      frame = window.requestAnimationFrame(loop);
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };
    const onLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        if (reduced) draw();
      }, 150);
    };

    resize();
    draw();
    if (!document.hidden) start();
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced]);

  return <canvas ref={ref} className="ambient-canvas" aria-hidden="true" />;
}
