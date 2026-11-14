import { useEffect, useRef } from "react";

/**
 * 主题化的动态背景：白天铺海浪，夜间铺电路流光。
 *
 * - 只在 [data-video-bg="on"] 的页面启用（登录页保持静态背景）
 * - 动效关闭（data-motion="off"）时暂停，避免"别的动效都停了、只有背景还在动"
 * - 两个 video 常驻 DOM、只切换透明度：换主题时不会黑屏或重新加载闪烁
 * - 未激活的那个始终 pause，不浪费解码
 */
export function AmbientVideo() {
  const dayRef = useRef<HTMLVideoElement>(null);
  const nightRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      const light = root.dataset.theme === "light";
      const videoBg = root.dataset.videoBg === "on";
      const motionOn = root.dataset.motion !== "off";
      const playable = videoBg && motionOn;

      const active = light ? dayRef.current : nightRef.current;
      const idle = light ? nightRef.current : dayRef.current;

      if (active) {
        if (playable) void active.play().catch(() => {});
        else if (!active.paused) active.pause();
      }
      if (idle && !idle.paused) idle.pause();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-motion", "data-video-bg"],
    });

    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="ambient-video-wrap ambient-video-day" aria-hidden="true">
        <video
          ref={dayRef}
          className="ambient-video"
          src="/backgrounds/sea-loop.webm"
          poster="/backgrounds/sea-loop.jpg"
          muted
          loop
          playsInline
          preload="auto"
        />
      </div>
      <div className="ambient-video-wrap ambient-video-night" aria-hidden="true">
        <video
          ref={nightRef}
          className="ambient-video"
          src="/backgrounds/circuit-loop.webm"
          poster="/backgrounds/circuit-loop.jpg"
          muted
          loop
          playsInline
          preload="auto"
        />
      </div>
    </>
  );
}
