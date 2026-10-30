import { useEffect, useRef } from "react";
import { THEME_REVEAL_BEGIN, THEME_REVEAL_END } from "./themeTransition";

/** 背景特效实例对外暴露的接口。气泡与鱼群两个特效的形状完全一致。 */
export type CanvasEffectHandle = {
  setTheme(theme?: string): void;
  setPaused(paused: boolean): void;
  setSweep(sweeping: boolean): void;
  destroy(): void;
};

export type CanvasEffectInit<H extends CanvasEffectHandle> = (
  canvas: HTMLCanvasElement,
  options: { theme?: string; paused?: boolean },
) => H;

/**
 * 把一个「Canvas 背景特效」挂到组件上：
 * 建画布引用 → 读 `<html>` 上的 data-theme / data-motion → 初始化特效 →
 * 监听属性变化与主题揭幕事件 → 卸载时销毁。
 *
 * 这段流程原先在 `BubbleBackground` 与 `FishBackground` 里各写了一遍
 * （43 / 44 行，只有 init 函数、canvas 类名与注释不同），抽到这里后两边都只剩两行。
 */
export function useCanvasEffect<H extends CanvasEffectHandle>(init: CanvasEffectInit<H>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const root = document.documentElement;
    const read = () => ({
      theme: root.dataset.theme,
      motionOff: root.dataset.motion === "off",
    });

    const initial = read();
    const effect = init(canvas, { theme: initial.theme, paused: initial.motionOff });

    // 主题 / 动效开关都写在 <html> 的 data-* 上，这里同步给画布
    const observer = new MutationObserver(() => {
      const next = read();
      effect.setTheme(next.theme);
      effect.setPaused(next.motionOff);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

    // 主题揭幕：开始前清空画布，分界线扫到哪里、哪里的内容就消失
    const onRevealBegin = () => effect.setSweep(true);
    const onRevealEnd = () => effect.setSweep(false);
    window.addEventListener(THEME_REVEAL_BEGIN, onRevealBegin);
    window.addEventListener(THEME_REVEAL_END, onRevealEnd);

    return () => {
      observer.disconnect();
      window.removeEventListener(THEME_REVEAL_BEGIN, onRevealBegin);
      window.removeEventListener(THEME_REVEAL_END, onRevealEnd);
      effect.destroy();
    };
    // init 是模块级函数，引用稳定；两个组件各传各的，不会互相触发重建
  }, [init]);

  return canvasRef;
}
