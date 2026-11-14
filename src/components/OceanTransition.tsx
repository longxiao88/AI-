import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";

/**
 * 登录 ⇄ 注册之间的「海水浮现」过场。
 *
 * 设计上刻意做得很轻，因为它只是过场，不该成为页面负担：
 *   - 初始不挂 src、preload="none"，首屏完全不下载；
 *   - 第一次真正切换时才 play()，把 1.24MB 的素材拉下来；
 *   - 每次播完立刻 pause + 清空 src + load()，把解码器还回去，
 *     不常驻一个全屏视频在那里吃显存；
 *   - 动效关闭（data-motion="off" 或系统偏好减少动态）时完全跳过，
 *     连视频都不加载，直接切视图。
 *
 * 视觉做法：水面整体淡入盖住旧页面 → 换内容 → 水整体退去、新页面浮现。
 * 进出对称，不做横向推进。
 */

const SRC = "/backgrounds/ocean-surge.webm";
const DUR = 2000; // 整段过场时长：2 秒，点完立刻有反馈，不让人干等
const VID_LEN = 2.0; // 素材本身的长度（秒），与 DUR 一致即为原速播放

/* 时间轴（占总时长的比例）
   0 → 0.46    水面整体浮现（淡入）
   0.46 → 0.62 整屏水，这一段里换内容
   0.55        切换视图
   0.62 → 1.0  水整体退去，新页面浮现（淡出）
   进出对称，观感像一次呼吸，而不是一条线扫过屏幕。 */
const T_FULL = 0.46; // 水面完全浮现
const T_SWITCH = 0.55; // 换内容（此时仍是不透明的整屏水）
const T_FADE = 0.62; // 开始退去
const RATE = VID_LEN / (DUR / 1000); // 原速；若以后素材比 DUR 长，这里会自动放慢

const easeOutCubic = (k: number) => 1 - (1 - k) ** 3;
const easeInOutSine = (k: number) => (1 - Math.cos(Math.PI * k)) / 2;

export type OceanTransitionHandle = {
  play: (onSwitch: () => void) => void;
};

function motionOff() {
  if (document.documentElement.dataset.motion === "off") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export const OceanTransition = forwardRef<OceanTransitionHandle>(function OceanTransition(_, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef(0);
  const busyRef = useRef(false);

  const cleanup = useCallback(() => {
    const v = videoRef.current;
    cancelAnimationFrame(rafRef.current);
    if (!v) return;
    v.pause();
    v.style.opacity = "0";
    v.style.maskImage = "";
    v.style.webkitMaskImage = "";
    // 把解码器还回去：清掉 src 再 load()，浏览器会释放这段视频占的显存
    v.removeAttribute("src");
    v.load();
    busyRef.current = false;
  }, []);

  const play = useCallback(
    (onSwitch: () => void) => {
      const v = videoRef.current;
      if (!v || busyRef.current) return;

      // 关掉动效就直接换，不加载任何东西
      if (motionOff()) {
        onSwitch();
        return;
      }

      busyRef.current = true;
      let switched = false;
      let started = false;
      let t0 = 0;

      const bail = () => {
        if (!switched) {
          switched = true;
          onSwitch();
        }
        cleanup();
      };

      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / DUR);

        /* 整体淡入淡出，不做横向推进：
           0 → T_FULL     水面像一层纱浮上来，下面的旧页面逐渐被盖住
           T_FULL → T_FADE 整屏水，切换在这段里发生
           T_FADE → 1     水退去，新页面浮现
           两段都用缓动，进出对称。 */
        let alpha: number;
        if (k < T_FULL) {
          alpha = easeOutCubic(k / T_FULL);
        } else if (k < T_FADE) {
          alpha = 1;
        } else {
          alpha = 1 - easeInOutSine((k - T_FADE) / (1 - T_FADE));
        }
        v.style.opacity = alpha.toFixed(3);

        if (!switched && k >= T_SWITCH) {
          switched = true;
          onSwitch();
        }

        if (k >= 1) {
          cleanup();
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };

      // 画面真正可播之后才启动时间轴，否则遮罩已经在推、水面还是黑的
      const begin = () => {
        if (started) return;
        started = true;
        v.removeEventListener("loadeddata", begin);
        v.playbackRate = RATE;
        void v.play().catch(bail);
        t0 = performance.now();
        rafRef.current = requestAnimationFrame(step);
      };

      // 首帧不给 src，避免浏览器在首屏就把整片拉下来
      if (!v.hasAttribute("src")) v.setAttribute("src", SRC);
      v.style.opacity = "1";

      if (v.readyState >= 2) {
        begin();
      } else {
        v.addEventListener("loadeddata", begin, { once: true });
        v.load();
        // 兜底：本地读盘异常时也不能把界面卡住
        window.setTimeout(() => {
          if (!started) begin();
        }, 500);
      }
    },
    [cleanup],
  );

  useImperativeHandle(ref, () => ({ play }), [play]);

  // 卸载时确保不留下解码器和 rAF
  useEffect(() => cleanup, [cleanup]);

  return (
    <video
      ref={videoRef}
      className="ocean-transition"
      preload="none"
      muted
      playsInline
      aria-hidden="true"
      tabIndex={-1}
    />
  );
});
