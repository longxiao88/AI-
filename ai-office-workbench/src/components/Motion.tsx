import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";

const Context = createContext({
  enabled: true,
  reduced: false,
  toggle: () => {},
});

export const useMotion = () => useContext(Context);

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [allowed, setAllowed] = useState(() => {
    try {
      return localStorage.getItem("ai-office-motion") !== "off";
    } catch {
      return true;
    }
  });
  const enabled = allowed && !reduced;

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.motion = enabled ? "on" : "off";
  }, [enabled]);

  // 鼠标划过按钮时留下一道短暂的光痕，最多同时存在 8 个
  useEffect(() => {
    if (!enabled) return;
    let last = 0;
    let x = 0;
    let y = 0;
    const sparks = new Set<HTMLElement>();
    const move = (e: PointerEvent) => {
      if (
        e.pointerType !== "mouse" ||
        Date.now() - last < 65 ||
        !(e.target instanceof Element) ||
        !e.target.closest("button:not(:disabled)")
      )
        return;
      last = Date.now();
      const angle = (Math.atan2(e.clientY - y, e.clientX - x) * 180) / Math.PI;
      x = e.clientX;
      y = e.clientY;
      const spark = document.createElement("i");
      spark.className = "pointer-spark";
      spark.setAttribute("aria-hidden", "true");
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      document.body.append(spark);
      sparks.add(spark);
      const animation = spark.animate(
        [
          {
            opacity: 0.65,
            transform: `translate(-50%,-50%) rotate(${angle}deg) scaleX(1)`,
          },
          {
            opacity: 0,
            transform: `translate(-50%,-50%) rotate(${angle}deg) scaleX(.1)`,
          },
        ],
        { duration: 420, easing: "ease-out" },
      );
      animation.onfinish = () => {
        spark.remove();
        sparks.delete(spark);
      };
      if (sparks.size > 8) {
        const oldest = sparks.values().next().value!;
        oldest.getAnimations().forEach((a) => a.cancel());
        oldest.remove();
        sparks.delete(oldest);
      }
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => {
      document.removeEventListener("pointermove", move);
      sparks.forEach((s) => {
        s.getAnimations().forEach((a) => a.cancel());
        s.remove();
      });
    };
  }, [enabled]);

  return (
    <Context.Provider
      value={{
        enabled,
        reduced,
        toggle: () => {
          const next = !allowed;
          setAllowed(next);
          try {
            localStorage.setItem("ai-office-motion", next ? "on" : "off");
          } catch {}
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function MotionToggle() {
  const { enabled, reduced, toggle } = useMotion();

  return (
    <button
      className="motion-toggle"
      onClick={toggle}
      disabled={reduced}
      aria-label={enabled ? "关闭动态效果" : "开启动态效果"}
      aria-pressed={enabled}
      title="动态效果跟随系统减少动态效果设置"
    >
      <Sparkles size={17} />
      <span>动效{enabled ? "开" : "关"}</span>
    </button>
  );
}
