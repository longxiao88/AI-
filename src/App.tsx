import { Chat } from "./modules/Chat";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, LogOut } from "lucide-react";
import { BrandMark } from "./components/BrandMark";
import type { AuthState, Profile as UserProfile } from "../shared/types";
import { BubbleBackground } from "./components/BubbleBackground/BubbleBackground";
import { CursorGlow } from "./components/CursorGlow/CursorGlow";
import { FishBackground } from "./components/FishBackground/FishBackground";
import { AmbientVideo } from "./components/AmbientVideo";
import { ScrollRail } from "./components/ScrollRail";
import { MotionToggle } from "./components/Motion";
import { ThemeToggle } from "./components/ThemeToggle";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { useI18n } from "./lib/i18n";
import { Button, cn, useConfirm } from "./components/ui";
import { appName, navigation, navTitleKey, type Page } from "./config";
import { api, message } from "./lib/api";
import type { ModuleProps } from "./lib/editor";
import { isPreview } from "./lib/runtime";
import { Clock, LiveTime } from "./modules/Clock";
import { Documents } from "./modules/Documents";
import { History } from "./modules/History";
import { Home } from "./modules/Home";
import { Knowledge } from "./modules/Knowledge";
import { Login } from "./modules/Login";
import { Meetings } from "./modules/Meetings";
import { Profile } from "./modules/Profile";
import { Projects } from "./modules/Projects";
import { Resources } from "./modules/Resources";
import { Search } from "./modules/Search";
import { Settings } from "./modules/Settings";
import { Writing } from "./modules/Writing";


export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState<Page>("home");
  const [initialId, setInitialId] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const { t } = useI18n();

  useEffect(() => {
    api<AuthState>("/auth/session")
      .then(setAuth)
      .catch((e) => setAuthError(message(e)));
  }, []);

  // 有未保存内容或 AI 正在处理时，关闭/刷新页面前让浏览器提示
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (dirty || busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  // 所有页面（含登录页）都启用主题化动态背景：
  // 登录页左侧的白色大标题压在场景轮播图上，轮播图本身就提供了深色底，
  // 所以底层换成海浪/电路视频不会影响文字可读性。
  useEffect(() => {
    document.documentElement.dataset.videoBg = "on";
  }, []);

  async function navigate(next: Page, id?: string) {
    if (busy) return;
    if (next === page && id === initialId) return;
    if (dirty && !(await confirm(t("shell.discardLeave")))) return;
    setDirty(false);
    setPage(next);
    setInitialId(id);
    window.scrollTo(0, 0);
  }

  async function logout() {
    if (busy) return;
    if (dirty && !(await confirm(t("shell.discardLogout")))) return;
    try {
      await api("/auth/logout", "POST");
      setDirty(false);
      // 退出后回到登录页，并刷新账号列表以便切换账号
      setAuth(await api<AuthState>("/auth/session"));
      setPage("home");
      setInitialId(undefined);
    } catch (e) {
      setAuthError(message(e));
    }
  }

  if (!auth)
    return (
      <main className="loading-screen">
        <BrandMark size={64} />
        <h1>{appName}</h1>
        <p role={authError ? "alert" : "status"}>{authError || t("shell.opening")}</p>
        {authError && <Button onClick={() => location.reload()}>重新连接</Button>}
      </main>
    );

  if (!auth.user)
    return (
      <>
        {/* 登录页只用自己的背景视频：主界面的海浪/电路视频在这里完全被盖住，
            保留会白占解码和带宽，和登录背景抢资源。 */}
        {/* 登录/注册页不提供昼夜切换，也不显示主题标题：
            这一页的背景是固定的深色场景视频，右上角只保留「动效」一个控件。
            主题本身仍然沿用上次的选择（由 main.tsx 的 initTheme 写入），
            真正的切换开关留在工作区里。 */}
        <div className="login-theme">
          <MotionToggle />
        </div>
        <Login state={auth} onLogin={setAuth} />
        {/* 气泡层：排在 .login-shell 之后、z-index 0 ——
            同层里它在背景视频（也是 0，但在 DOM 更前）之上，
            而表单内容由 .login-shell > * 提到 z-index 1，仍在它上面。
            顺序不能反：放到前面就会被背景视频整块盖住。 */}
        <BubbleBackground surface="dark" />
        {/* 鼠标气泡跟随：光点喷在光标处，缓缓上浮淡出 */}
        <CursorGlow />
        <ScrollRail />
      </>
    );

  const user = auth.user;
  const updateUser = (next: UserProfile) => setAuth({ ...auth, user: next });
  const pageIndex = navigation.findIndex((n) => n.id === page);
  const meta = navigation[pageIndex];
  const moduleProps: ModuleProps = {
    onDirty: setDirty,
    onBusy: setBusy,
    initialId,
    goTo: (p, id) => void navigate(p, id),
  };

  const pages: Record<Page, () => ReactNode> = {
    home: () => <Home user={user} navigate={(p, id) => void navigate(p, id)} />,
    search: () => <Search navigate={(p, id) => void navigate(p, id)} />,
    chat: () => <Chat onDirty={setDirty} onBusy={setBusy} />,
    writing: () => <Writing {...moduleProps} />,
    meetings: () => <Meetings {...moduleProps} />,
    projects: () => <Projects {...moduleProps} />,
    documents: () => <Documents {...moduleProps} />,
    knowledge: () => <Knowledge {...moduleProps} />,
    resources: () => <Resources onBusy={setBusy} />,
    clock: () => <Clock />,
    history: () => <History />,
    profile: () => (
      <Profile
        user={user}
        onUpdate={updateUser}
        onDirty={setDirty}
        focusEmail={initialId === "email"}
      />
    ),
    settings: () => (
      <Settings
        onDirty={setDirty}
        onBusy={setBusy}
        onGoBindEmail={() => void navigate("profile", "email")}
      />
    ),
  };

  let status = isPreview ? "PREVIEW" : "LOCAL";
  if (dirty) status = t("shell.dirty");
  if (busy) status = t("shell.busy");

  return (
    <div className="app-shell">
      <AmbientVideo />
      <div className="ambient-bg" aria-hidden="true" />
      <BubbleBackground />
      <FishBackground />
      <CursorGlow />
      <ScrollRail />
      {/* 左侧导航列：顶部品牌栏、中间导航、底部账号栏，三条横带各司其职 */}
      <aside className="app-sidebar">
        <div className="sidebar-top">
          <div className="brand-lockup">
            <BrandMark size={48} />
            <span>
              {appName}
              <small>INTELLIGENT WORKSPACE</small>
            </span>
          </div>
        </div>

        <div className="nav-section-label">{t("shell.navSection")}</div>
        <nav aria-label={t("shell.mainNav")}>
          {navigation.map((item) => (
            <button
              key={item.id}
              disabled={busy}
              onClick={() => void navigate(item.id)}
              aria-current={page === item.id ? "page" : undefined}
              className={cn(
                "nav-item",
                page === item.id && "is-active",
                item.id === "profile" && "nav-break",
              )}
            >
              <item.icon size={18} />
              <span>{t(navTitleKey(item.id))}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="system-note">
            <span className="status-dot" />
            {isPreview ? t("shell.previewMode") : t("shell.localMode")}
            <p>{isPreview ? t("shell.previewNote") : t("shell.localNote")}</p>
          </div>
          <button className="sidebar-user" onClick={() => void navigate("profile")} disabled={busy}>
            <span className="avatar-small" aria-hidden="true">
              {user.name.slice(0, 1)}
            </span>
            <span className="sidebar-user-text">
              <strong>{user.name}</strong>
              <small>{user.role || t("shell.defaultRole")}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
          <button className="logout" disabled={busy} onClick={() => void logout()}>
            <LogOut size={14} />
            {t("shell.logout")}
          </button>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-header">
          <span className="crumbs">
            {t("shell.breadcrumb")}<span className="breadcrumb-slash">/</span>
            <strong>{t(navTitleKey(meta.id))}</strong>
          </span>
          <div className="header-status">
            <LanguageSwitcher />
            <MotionToggle />
            <ThemeToggle />
            <LiveTime />
            <span className="header-divider" />
            <span>{status}</span>
          </div>
        </header>

        <div className="page-content">
          {isPreview && (
            <div className="preview-note">
              <span className="status-dot" />
              <span>演示模式 · 数据仅保存在当前浏览器，AI 功能需在本机完整版中配置后使用。</span>
            </div>
          )}
          {authError && <p role="alert">{authError}</p>}
          {/* 页头只留一个名词标题。
              原来的三样都拿掉了：
                · 「SEARCH」全大写小标签 —— 生成页的典型痕迹，和页面标题重复；
                · 右上角 /02 页码 —— 纯装饰，不承载任何信息；
                · 副标题「在一个地方，找到你写过的一切。」—— 是产品口号，
                  不是这一页的数据或范围。范围交给页面自己的内容说。 */}
          <div className="page-heading">
            <h1>{t(navTitleKey(meta.id))}</h1>
          </div>
          <div className="page-stage" key={`${page}-${initialId || ""}`}>
            {pages[page]()}
          </div>
        </div>
      </main>
    </div>
  );
}
