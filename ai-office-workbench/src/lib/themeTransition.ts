/**
 * 主题切换的「从底部向上揭幕」过渡。
 *
 * 用 View Transitions API：浏览器会把切换前后的页面各截一张快照，
 * 我们把「切换后（新主题）」那张的遮罩自下而上推过去 ——
 * 可见区域就从屏幕底边一路长到顶部，也就是新主题的黑/白从底部升起占满屏幕。
 *
 * 遮罩用的是带羽化的渐变（定义在 style.css 的 ::view-transition-new(root)），
 * 所以新主题的边界始终是一条柔和的过渡带，而不是一条硬邦邦的颜色分界线。
 *
 * 不支持该 API 的浏览器（例如 Firefox）直接瞬时切换，功能不受影响；
 * 关闭动效（含系统「减少动态效果」）时同样走瞬时切换。
 */

/** 揭幕时长，和 CSS 里各自动画的节奏保持一致 */
const REVEAL_MS = 620;
/** 缓动：中段匀速上升、收尾缓慢停住，避免"升到顶突然刹车" */
const REVEAL_EASING = "cubic-bezier(0.45, 0, 0.2, 1)";

/**
 * 遮罩位移的起止位置，和 style.css 里 ::view-transition-new(root) 的
 * mask-size: 100% 200% 配套：
 *   - 起点 -24%：羽化带最淡的一端刚好落在屏幕底边（此刻屏幕上还看不出新主题）
 *   - 终点 100%：实心段铺满整屏
 * 中间的位移量约为视口高度的 1.24 倍。
 */
const MASK_FROM = "50% -24%";
const MASK_TO = "50% 100%";

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition?: () => void;
};

type TransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike;
};

function getStarter(): ((callback: () => void | Promise<void>) => ViewTransitionLike) | undefined {
  if (typeof document === "undefined") return undefined;
  const doc = document as unknown as TransitionDocument;
  const start = doc.startViewTransition;
  return typeof start === "function" ? start.bind(doc) : undefined;
}

/** 当前浏览器是否支持视图过渡 */
export const supportsViewTransition = () => getStarter() !== undefined;

/**
 * 切换主题，并在支持的浏览器里播放「新主题从底部升起」的揭幕动画。
 *
 * @param update 必须【同步】把新主题写到 DOM 上（data-theme / 背景色等），
 *               View Transitions 会在它返回后立刻截「切换后」的快照。
 * @param motionEnabled 动效开关；为 false 时只做瞬时切换。
 */
export function revealThemeChange(update: () => void, motionEnabled = true): void {
  const start = getStarter();
  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!motionEnabled || reduced || !start) {
    update();
    return;
  }

  const transition = start(update);

  transition.ready
    .then(() => {
      document.documentElement.animate(
        // 把羽化遮罩从屏幕下方推到上方：新主题带一条柔和的过渡带升起来
        { maskPosition: [MASK_FROM, MASK_TO], webkitMaskPosition: [MASK_FROM, MASK_TO] },
        { duration: REVEAL_MS, easing: REVEAL_EASING, pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {
      // 连续快速点击时上一次过渡会被跳过，这里无需处理
    });

  // 过渡被跳过时 finished 也会 reject，避免控制台出现未捕获异常
  transition.finished.catch(() => {});
}
