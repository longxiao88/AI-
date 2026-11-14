import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MotionProvider } from "./components/Motion";
import { initTheme } from "./components/ThemeToggle";
import { ConfirmProvider } from "./components/ui";
import { I18nProvider } from "./lib/i18n";
import "./style.css";

// 主题必须先于首屏渲染落到 <html> 上：登录页没有主题开关，等组件挂载再写
// 会先闪一帧默认深色，看起来像主题被重置了。
initTheme();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <MotionProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </MotionProvider>
    </I18nProvider>
  </React.StrictMode>,
);
