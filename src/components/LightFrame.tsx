import { useEffect, useRef, useState } from "react";
import { useMotion } from "./Motion";

/** 卡片边缘的流光装饰，纯视觉效果，不响应鼠标事件。离开视口或页面隐藏时暂停动画。 */
export function LightFrame({ delay = 0 }: { delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { enabled } = useMotion();
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (ref.current) observer.observe(ref.current);
    const update = () => setForeground(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      className="light-frame"
      data-running={enabled && visible && foreground}
    >
      <span className="frame-runner" style={{ animationDelay: `-${delay}s` }} />
    </span>
  );
}
