import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { useMotion } from "./Motion";
import { revealThemeChange } from "../lib/themeTransition";
import { useI18n } from "../lib/i18n";

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

/**
 * 首屏渲染前把上次选的主题落到 <html> 上。
 *
 * 登录/注册页已经没有主题开关（App 只在工作区里渲染 ThemeToggle），
 * 所以这一页的主题没人负责写入。没有这一步，从工作区退出后会停在
 * `:root` 的默认深色上，用户之前选的白天主题看起来就像被重置了。
 *
 * 只读不写：不会改变用户已经做出的选择。
 */
export function initTheme() {
  document.documentElement.dataset.theme = readTheme();
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const { enabled: motion } = useMotion();
  const { t } = useI18n();

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
      aria-label={theme === "dark" ? t("toggle.themeToLight") : t("toggle.themeToDark")}
      title={theme === "dark" ? t("toggle.themeToLight") : t("toggle.themeToDark")}
      onClick={toggle}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      <span className="theme-track" aria-hidden="true">
        <i />
      </span>
      <span>{theme === "dark" ? t("toggle.light") : t("toggle.dark")}</span>
    </button>
  );
}
