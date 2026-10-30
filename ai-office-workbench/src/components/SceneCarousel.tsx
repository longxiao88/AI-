import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMotion } from "./Motion";

const INTERVAL = 5000;
/** 松手判定：擦除进度超过 18% 就完成切换，否则回弹 */
const SWIPE_RATIO = 0.18;
/** 擦除动画时长，与 CSS 的 transition 保持一致 */
const WIPE_MS = 1500;

const scenes = [
  { src: "/images/scene-abyss-beacon.jpg", name: "深海灯塔", tag: "SIGNAL FROM THE DEEP" },
  { src: "/images/scene-tidal-city.jpg", name: "潮汐之城", tag: "CITY OF TIDES" },
  { src: "/images/scene-custom.jpg", name: "新场景", tag: "NEW SCENE" },
  { src: "/images/scene-dark.jpg", name: "暗境", tag: "DARK REALM" },
];

/**
 * 登录页和首页的背景轮播。
 *
 * 切换方式是「擦除翻页」而不是横向滑动：图片本身不移动，
 * 当前图用遮罩从一侧擦掉，露出压在下面的目标图。
 * 往左拖 = 当前图从右往左被擦掉（看下一张），往右拖则相反。
 * 拖动时擦除进度跟手，松手超过阈值就擦完并换图，否则回弹。
 */
export function SceneCarousel({ login = false }: { login?: boolean }) {
  const { enabled } = useMotion();
  const count = scenes.length;
  const [index, setIndex] = useState(0);
  /** 1 = 从右往左擦（看下一张），-1 = 从左往右擦（看上一张） */
  const [dir, setDir] = useState<1 | -1>(1);
  /** 擦除进度 0..1 */
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [animating, setAnimating] = useState(false);
  /** 换图那一帧禁用过渡，把遮罩瞬间归位，避免新图淡入 */
  const [instant, setInstant] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [inView, setInView] = useState(true);
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const progressRef = useRef(0);
  const dirRef = useRef<1 | -1>(1);
  /** 点胶囊时的目标索引；为空表示只前进/后退一张（拖拽、自动轮播） */
  const pendingRef = useRef<number | null>(null);
  const axis = useRef<"" | "x" | "y">("");

  const targetIndex = (index + dir + count) % count;
  const nextScene = scenes[(index + 1) % count];
  const running =
    enabled &&
    !hover &&
    !focused &&
    visible &&
    inView &&
    !dragging &&
    !animating &&
    !!ready[nextScene.src];

  // 预加载四张图：否则切到尚未加载完的那张时，running 会一直为 false，看起来像卡住
  useEffect(() => {
    scenes.forEach((scene) => {
      const img = new Image();
      img.onload = () => setReady((r) => (r[scene.src] ? r : { ...r, [scene.src]: true }));
      img.src = scene.src;
    });
  }, []);

  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    change();
    document.addEventListener("visibilitychange", change);
    const observer = new IntersectionObserver((entries) => setInView(entries[0].isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => {
      document.removeEventListener("visibilitychange", change);
      observer.disconnect();
    };
  }, []);

  // 擦除完成：等动画走完再换图，此时上层已全透明，换谁都不会被看到
  useEffect(() => {
    if (!animating) return;
    const id = window.setTimeout(() => {
      setInstant(true);
      const target = pendingRef.current;
      pendingRef.current = null;
      setIndex((i) => (target === null ? (i + dirRef.current + count) % count : target));
      progressRef.current = 0;
      setProgress(0);
      setAnimating(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)));
    }, WIPE_MS + 60);
    return () => clearTimeout(id);
  }, [animating, count]);

  // 自动轮播
  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => {
      dirRef.current = 1;
      setDir(1);
      progressRef.current = 1;
      setProgress(1);
      setAnimating(true);
    }, INTERVAL);
    return () => clearTimeout(id);
  }, [running, index]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || animating) return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = "";
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    if (!axis.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "y") {
        start.current = null;
        return;
      }
      setDragging(true);
    }

    const width = viewport.current?.offsetWidth || 1;
    // 往左拖（dx < 0）看下一张：当前图从右往左被擦掉
    const nextDir: 1 | -1 = dx < 0 ? 1 : -1;
    if (nextDir !== dirRef.current) {
      dirRef.current = nextDir;
      setDir(nextDir);
    }
    const p = Math.min(1, Math.abs(dx) / width);
    progressRef.current = p;
    setProgress(p);
  }

  function endDrag() {
    const wasDragging = start.current && axis.current === "x";
    start.current = null;
    axis.current = "";
    setDragging(false);
    if (!wasDragging) return;

    if (progressRef.current >= SWIPE_RATIO) {
      progressRef.current = 1;
      setProgress(1);
      setAnimating(true);
    } else {
      progressRef.current = 0;
      setProgress(0);
    }
  }

  /** 点胶囊跳转：按环形距离决定擦除方向 */
  function jumpTo(target: number) {
    if (animating || target === index) return;
    const forward = (target - index + count) % count;
    const d: 1 | -1 = forward <= count / 2 ? 1 : -1;
    dirRef.current = d;
    pendingRef.current = target;
    setDir(d);
    progressRef.current = 1;
    setProgress(1);
    setAnimating(true);
  }

  /*
   * 遮罩是一条「左实右虚」的渐变，放大到 200% 后靠 mask-position 从 0% 推到 100%：
   * 渐变位置是可以插值的，而 linear-gradient 本身不行（会一下跳到终态，看起来像卡帧）。
   */
  const topStyle: CSSProperties = {
    maskPosition: `${progress * 100}% 0`,
    WebkitMaskPosition: `${progress * 100}% 0`,
    transition: dragging || instant
      ? "none"
      : `mask-position ${WIPE_MS}ms linear, -webkit-mask-position ${WIPE_MS}ms linear`,
  };

  return (
    <div
      ref={root}
      className={`scene-carousel ${login ? "scene-login" : ""}`}
      role="region"
      aria-roledescription="轮播"
      aria-label="科技主题背景"
      data-scene={index}
      data-running={running}
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHover(true);
      }}
      onPointerLeave={() => setHover(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false);
      }}
    >
      <div
        ref={viewport}
        className="scene-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* 底层：目标图，被擦开后露出的就是它 */}
        <div className="scene-layer" aria-hidden="true">
          <img
            src={scenes[targetIndex].src}
            alt=""
            draggable={false}
            onLoad={() => setReady((r) => ({ ...r, [scenes[targetIndex].src]: true }))}
          />
        </div>
        {/* 上层：当前图，用遮罩从一侧擦掉 */}
        <div
          className={`scene-layer scene-layer-top ${dir === 1 ? "wipe-l" : "wipe-r"}`}
          style={topStyle}
        >
          <img
            src={scenes[index].src}
            alt={`${scenes[index].name}玻璃装置`}
            draggable={false}
            fetchPriority="high"
            onLoad={() => setReady((r) => ({ ...r, [scenes[index].src]: true }))}
          />
        </div>
      </div>
      <div className="scene-caption">
        <span>
          0{index + 1} / 0{count}
        </span>
        <strong>{scenes[index].name}</strong>
        <small>{scenes[index].tag}</small>
      </div>
      <div className="scene-dots">
        {scenes.map((s, i) => (
          <button
            key={s.name}
            type="button"
            className="scene-dot"
            aria-label={`切换背景：${s.name}`}
            aria-pressed={i === index}
            onClick={() => jumpTo(i)}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}
