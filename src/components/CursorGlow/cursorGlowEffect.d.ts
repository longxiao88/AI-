export type CursorGlowOptions = {
  /** 初始主题（"light" | "dark"），缺省按深色配色 */
  theme?: string;
  /** 初始是否暂停；组件会在 data-motion="off" 时置为 true */
  paused?: boolean;
};

export type CursorGlowHandle = {
  /** 切换深浅色配色，已在屏幕上的粒子会沿用旧色直到消散 */
  setTheme(theme?: string): void;
  /** 暂停 / 恢复拖尾；暂停时清空已生成的粒子 */
  setPaused(paused: boolean): void;
  /** 销毁：取消动画帧、移除全部事件监听，组件卸载时必须调用 */
  destroy(): void;
};

/** 初始化光标发光拖尾特效 */
export function initCursorGlow(
  canvas: HTMLCanvasElement,
  options?: CursorGlowOptions,
): CursorGlowHandle;
