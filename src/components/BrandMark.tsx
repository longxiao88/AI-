import { useEffect, useState } from "react";

/**
 * AIpharis Muse 品牌标记 —— 参考图图形原样搬运（透明位图）。
 * 图形：A（深藏青）+ M（青蓝渐变）+ 灯塔 + 两颗金星。
 *
 * 位图由 scripts/make-brandmark.py 从 generated-images 的参考图抠出：
 * 渐变米白背景已反解为透明，缩放走预乘 alpha，边缘不留白边。
 *
 * 两版素材的唯一差别是「暗部提亮」：参考图里 A 是深藏青 #1B2A6B，
 * 原样放在深蓝侧栏 / 登录页视频上会整个融进背景，所以深色底改用
 * brand-mark-lit.png（只抬 HSV 的 V，色相与饱和度不动）。
 */

type Theme = "dark" | "light";

const SRC: Record<Theme, string> = {
  dark: "/images/brand-mark-lit.png",
  light: "/images/brand-mark.png",
};

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function BrandMark({
  size = 24,
  /**
   * follow：跟随 <html data-theme>（侧栏用）
   * onDark：始终用提亮版（登录页艺术层无论主题都是深色底）
   */
  tone = "follow",
}: {
  size?: number;
  tone?: "follow" | "onDark";
}) {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    if (tone === "onDark") return;
    const root = document.documentElement;
    const sync = () => setTheme(readTheme());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, [tone]);

  const src = tone === "onDark" ? SRC.dark : SRC[theme];

  return (
    <img
      className="brand-mark"
      src={src}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
    />
  );
}
