export type FishEffectOptions = {
  /** 初始主题（"light" | "dark"），缺省按深色渲染 */
  theme?: string;
  /** 初始是否暂停；组件会在 data-motion="off" 时置为 true */
  paused?: boolean;
};

export type FishEffectHandle = {
  /** 切换深浅色配色，已存在的鱼会立即换色 */
  setTheme(theme?: string): void;
  /** 暂停 / 恢复动画；关闭时会清空屏幕上的鱼，恢复后重新生成 */
  setPaused(paused: boolean): void;
  /**
   * 主题揭幕开始 / 结束。
   * 开始时清空鱼群并暂停绘制，使"新主题"快照拍到空画布。
   */
  setSweep(sweeping: boolean): void;
  /** 销毁：取消动画帧、移除全部事件监听，组件卸载时必须调用 */
  destroy(): void;
};

/** 初始化鱼群背景特效 */
export function initFishEffect(
  canvas: HTMLCanvasElement,
  options?: FishEffectOptions,
): FishEffectHandle;
