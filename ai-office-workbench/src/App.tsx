import { Chat } from "./modules/Chat";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Layers3, LogOut } from "lucide-react";
import type { AuthState, Profile as UserProfile } from "../shared/types";
import { BubbleBackground } from "./components/BubbleBackground/BubbleBackground";
import { FishBackground } from "./components/FishBackground/FishBackground";
import { ScrollRail } from "./components/ScrollRail";
import { MotionToggle } from "./components/Motion";
import { ThemeToggle } from "./components/ThemeToggle";
import { Button, cn, useConfirm } from "./components/ui";
import { appName, navigation, type Page } from "./config";
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

const pad = (n: number) => String(n).padStart(2, "0");

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState<Page>("home");
  const [initialId, setInitialId] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

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

  async function navigate(next: Page, id?: string) {
    if (busy) return;
    if (next === page && id === initialId) return;
    if (dirty && !(await confirm("当前内容尚未保存，确认放弃修改并离开吗？"))) return;
    setDirty(false);
    setPage(next);
    setInitialId(id);
    window.scrollTo(0, 0);
  }

  async function logout() {
    if (busy) return;
    if (dirty && !(await confirm("当前内容尚未保存，确认退出并放弃修改吗？"))) return;
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
        <Layers3 size={36} />
        <h1>{appName}</h1>
        <p role={authError ? "alert" : "status"}>{authError || "正在打开工作空间…"}</p>
        {authError && <Button onClick={() => location.reload()}>重新连接</Button>}
      </main>
    );

  if (!auth.user)
    return (
      <>
        <div className="ambient-bg" aria-hidden="true" />
        <BubbleBackground />
        <FishBackground />
        <div className="login-theme">
          <MotionToggle />
          <ThemeToggle />
        </div>
        <Login state={auth} onLogin={setAuth} />
        <ScrollRail />
      </>
    );

  const user = auth.user;
  const updateUser = (next: UserProfile) => setAuth({ ...auth, user: next });
  const pageIndex = navigation.findIndex((n) => n.id === page);
  const meta = navigation[pageIndex];
  const moduleProps: ModuleProps = { onDirty: setDirty, onBusy: setBusy, initialId };

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
  if (dirty) status = "有未保存的修改";
  if (busy) status = "AI 正在处理";

  return (
    <div className="app-shell">
      <div className="ambient-bg" aria-hidden="true" />
      <BubbleBackground />
      <FishBackground />
      <ScrollRail />
      {/* 左侧导航列：顶部品牌栏、中间导航、底部账号栏，三条横带各司其职 */}
      <aside className="app-sidebar">
        <div className="sidebar-top">
          <div className="brand-lockup">
            <Layers3 size={24} />
            <span>
              {appName}
              <small>INTELLIGENT WORKSPACE</small>
            </span>
          </div>
        </div>

        <div className="nav-section-label">WORKSPACE / 工作空间</div>
        <nav aria-label="主导航">
          {navigation.map((item, index) => (
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
              <span>{item.title}</span>
              <span aria-hidden="true" className="nav-index">
                {pad(index + 1)}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="system-note">
            <span className="status-dot" />
            {isPreview ? "浏览器演示模式" : "本机工作空间"}
            <p>{isPreview ? "试填内容仅保存在你的浏览器" : "资料保存在本机 SQLite 中"}</p>
          </div>
          <button className="sidebar-user" onClick={() => void navigate("profile")} disabled={busy}>
            <span className="avatar-small" aria-hidden="true">
              {user.name.slice(0, 1)}
            </span>
            <span className="sidebar-user-text">
              <strong>{user.name}</strong>
              <small>{user.role || "个人工作空间"}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
          <button className="logout" disabled={busy} onClick={() => void logout()}>
            <LogOut size={14} />
            退出登录
          </button>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-header">
          <span className="crumbs">
            工作空间<span className="breadcrumb-slash">/</span>
            <strong>{meta.title}</strong>
          </span>
          <div className="header-status">
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
          <div className="page-heading">
            <div>
              <span className="eyebrow">{page === "home" ? "OVERVIEW" : page.toUpperCase()}</span>
              <h1>{meta.title}</h1>
              <p>{meta.description}</p>
            </div>
            <span className="page-number">/{pad(pageIndex + 1)}</span>
          </div>
          <div className="page-stage" key={`${page}-${initialId || ""}`}>
            {pages[page]()}
          </div>
        </div>
      </main>
    </div>
  );
}
