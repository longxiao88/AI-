export type BubbleEffectOptions = {
  /** 初始主题（"light" | "dark"），缺省按深色渲染 */
  theme?: string;
  /** 初始是否暂停；组件会在 data-motion="off" 时置为 true */
  paused?: boolean;
  /** 点击气泡是否爆炸，默认 true */
  interactive?: boolean;
};

export type BubbleEffectHandle = {
  /** 切换深浅色配色，已存在的气泡会立即换色 */
  setTheme(theme?: string): void;
  /** 暂停 / 恢复动画；暂停时冻结画面并停止 rAF */
  setPaused(paused: boolean): void;
  /** 销毁：取消动画帧、移除全部事件监听，组件卸载时必须调用 */
  destroy(): void;
};

/** 初始化气泡背景特效 */
export function initBubbleEffect(
  canvas: HTMLCanvasElement,
  options?: BubbleEffectOptions,
): BubbleEffectHandle;
