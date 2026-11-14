import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { useMotion } from "./Motion";
import { revealThemeChange } from "../lib/themeTransition";

type Theme = "dark" | "light";

const STORAGE_KEY = "ai-office-theme";

function readTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** <html data-theme> 是全站唯一的主题来源：样式表、背景气泡都读它 */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 浏览器禁用了存储时仍然可以切换，只是不会记住
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const { enabled: motion } = useMotion();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    revealThemeChange(() => {
      // 必须同步落到 DOM：View Transitions 会在回调返回后立刻截「切换后」的快照，
      // 交给 React 异步提交会截到旧主题。
      flushSync(() => setTheme(next));
      applyTheme(next);
    }, motion);
  }

  return (
    <button
      className="theme-toggle"
      aria-label={theme === "dark" ? "切换白天模式" : "切换黑夜模式"}
      title={theme === "dark" ? "切换白天模式" : "切换黑夜模式"}
      onClick={toggle}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      <span className="theme-track" aria-hidden="true">
        <i />
      </span>
      <span>{theme === "dark" ? "白天" : "黑夜"}</span>
    </button>
  );
}
