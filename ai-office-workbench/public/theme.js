// 在页面渲染前先设置主题，避免刷新时闪一下默认配色
try {
  document.documentElement.dataset.theme =
    localStorage.getItem("ai-office-theme") === "light" ? "light" : "dark";
} catch {
  // 读不到存储时保持默认的夜间主题
}
