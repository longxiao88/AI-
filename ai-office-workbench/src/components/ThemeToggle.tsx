import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("ai-office-theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ai-office-theme", theme);
    } catch {
      // 浏览器禁用了存储时仍然可以切换，只是不会记住
    }
  }, [theme]);

  return (
    <button
      className="theme-toggle"
      aria-label={theme === "dark" ? "切换白天模式" : "切换黑夜模式"}
      title={theme === "dark" ? "切换白天模式" : "切换黑夜模式"}
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      <span className="theme-track" aria-hidden="true">
        <i />
      </span>
      <span>{theme === "dark" ? "白天" : "黑夜"}</span>
    </button>
  );
}
