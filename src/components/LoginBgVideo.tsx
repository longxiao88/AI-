import { useEffect, useRef } from "react";

/**
 * 登录页背景，两层视频：
 *
 * 空闲时（用户没在填写表单）→ 播 `login-idle.mp4`（洞窟全息动画）
 * 一旦聚焦到任何输入框 → 切回当前视图原本的背景视频：
 *   登录视图 = login-cavern.mp4
 *   注册视图 = cave-tree-loop.webm（+ 黑夜模式的深色滤镜）
 *
 * 两层都常驻 DOM，只切透明度，切换时不黑屏、不重新加载；
 * 不可见的那一层始终 pause，避免两路全屏视频同时解码。
 */
const IDLE_SRC = "/backgrounds/login-idle.mp4";
const LOGIN_SRC = "/backgrounds/login-cavern.mp4";
const REGISTER_SRC = "/backgrounds/cave-tree-loop.webm";

type Props = {
  engaged: boolean;
  isRegister: boolean;
};

export function LoginBgVideo({ engaged, isRegister }: Props) {
  const idleRef = useRef<HTMLVideoElement>(null);
  const mainRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      const motionOn = root.dataset.motion !== "off";
      const idle = idleRef.current;
      const main = mainRef.current;

      if (!motionOn) {
        idle?.pause();
        main?.pause();
        return;
      }

      // 注册页只有一层（自己的发光树视频），始终播放，不参与空闲切换
      if (isRegister) {
        void main?.play().catch(() => {});
        return;
      }

      if (engaged) {
        void main?.play().catch(() => {});
        if (idle && !idle.paused) idle.pause();
      } else {
        void idle?.play().catch(() => {});
        if (main && !main.paused) main.pause();
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

    return () => observer.disconnect();
  }, [engaged, isRegister]);

  // 登录页的第二层视频（login-cavern）只在聚焦输入框后才露面，
  // 首屏不需要它。这里给它 2.5 秒的空闲窗口再后台拉取，
  // 既不让首屏白等 1MB，也避免用户真的聚焦时看到一片空白。
  useEffect(() => {
    if (isRegister || engaged) return;
    const timer = window.setTimeout(() => {
      const v = mainRef.current;
      if (!v || !v.paused) return;
      v.preload = "auto";
      v.load();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [isRegister, engaged]);

  // loop 在某些环境下会失效停在末帧，这里兜底重播
  const restart = (el: HTMLVideoElement | null) => {
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => {});
  };

  return (
    <>
      {/* 空闲动画：只用于登录页，注册页保留自己的背景，两页内容不同 */}
      {!isRegister && (
      <video
        ref={idleRef}
        className="login-bg-video login-bg-idle"
        src={IDLE_SRC}
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        onEnded={() => restart(idleRef.current)}
      />
      )}

      {/* 填写时使用的背景：按视图切换源。
          注册页这一层就是背景本身，必须立刻加载；
          登录页它只在聚焦后露面，先不预读（见上面的空闲加载）。 */}
      <video
        key={isRegister ? "reg" : "login"}
        ref={mainRef}
        className={`login-bg-video ${isRegister ? "login-bg-video-night" : "login-bg-video-login"}`}
        src={isRegister ? REGISTER_SRC : LOGIN_SRC}
        muted
        loop
        playsInline
        preload={isRegister ? "auto" : "none"}
        aria-hidden="true"
        onEnded={() => restart(mainRef.current)}
      />

      {/* 原先这里有一层注册页专用的深色滤镜，已移除：
          它只是把发光树压暗，对白字的可读性没有帮助。 */}
    </>
  );
}
