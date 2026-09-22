import { useEffect, useRef, useState } from "react";
import { Pause, Play, ArrowLeft, ArrowRight } from "lucide-react";
import { useMotion } from "./Motion";

const INTERVAL = 8000;

export const scenes = [
  { src: "/images/scene-core.png", name: "灵感核心", tag: "INTELLIGENCE CORE" },
  { src: "/images/scene-orbit.png", name: "知识星环", tag: "CONNECTED KNOWLEDGE" },
];

/** 登录页和首页的背景轮播：支持拖动切换，悬停、聚焦、页面隐藏或关闭动效时暂停。 */
export function SceneCarousel({ login = false }: { login?: boolean }) {
  const { enabled } = useMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [inView, setInView] = useState(true);
  const [ready, setReady] = useState<Record<number, boolean>>({});
  const root = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // 第二张图加载完成之前不自动切换，避免切到空白
  const running = enabled && !paused && !hover && !focused && visible && inView && !!ready[1];

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

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % scenes.length), INTERVAL);
    return () => clearInterval(id);
  }, [running, index]);

  function change(next: number) {
    setIndex((next + scenes.length) % scenes.length);
  }

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
        className="scene-viewport"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragStart.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          const p = dragStart.current;
          dragStart.current = null;
          if (
            p &&
            Math.abs(e.clientX - p.x) > 50 &&
            Math.abs(e.clientX - p.x) > Math.abs(e.clientY - p.y)
          ) {
            change(index + (e.clientX < p.x ? 1 : -1));
            setPaused(true);
          }
        }}
        onPointerCancel={() => {
          dragStart.current = null;
        }}
      >
        {scenes.map((scene, i) => (
          <div
            key={scene.src}
            className={`scene-image ${i === index ? "scene-active" : ""}`}
            aria-hidden={i !== index}
          >
            <img
              src={scene.src}
              alt={scene.name + "玻璃装置"}
              draggable={false}
              fetchPriority={i === 0 ? "high" : "auto"}
              onLoad={() => setReady((r) => ({ ...r, [i]: true }))}
            />
          </div>
        ))}
        <div className="scene-grid" aria-hidden="true" />
      </div>
      <div className="scene-controls">
        <div className="scene-caption">
          <span>
            0{index + 1} / 0{scenes.length}
          </span>
          <strong>{scenes[index].name}</strong>
          <small>{scenes[index].tag}</small>
        </div>
        <div className="scene-actions">
          <button
            onClick={() => {
              change(index - 1);
              setPaused(true);
            }}
            aria-label="上一张背景"
          >
            <ArrowLeft size={14} />
          </button>
          {scenes.map((s, i) => (
            <button
              key={s.name}
              className="scene-dot"
              aria-label={`切换背景：${s.name}`}
              aria-pressed={i === index}
              onClick={() => {
                change(i);
                setPaused(true);
              }}
            >
              <span />
            </button>
          ))}
          <button
            onClick={() => {
              change(index + 1);
              setPaused(true);
            }}
            aria-label="下一张背景"
          >
            <ArrowRight size={14} />
          </button>
          <button
            disabled={!enabled}
            onClick={() => setPaused(!paused)}
            aria-label={paused ? "播放背景轮播" : "暂停背景轮播"}
          >
            {paused || !enabled ? <Play size={14} /> : <Pause size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
