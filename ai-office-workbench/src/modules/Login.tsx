import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Layers3,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { ACCOUNT } from "../../shared/constants";
import type { AuthState, Profile } from "../../shared/types";
import { LightFrame } from "../components/LightFrame";
import { SceneCarousel } from "../components/SceneCarousel";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";

type View = "login" | "register" | "forgot";

/** 与后端一致：一个工作空间最多 3 个账号 */
const MAX_ACCOUNTS = ACCOUNT.maxAccounts;

export function Login({
  state,
  onLogin,
}: {
  state: AuthState;
  onLogin: (state: AuthState) => void;
}) {
  const hasAccounts = state.accounts.length > 0;
  const [view, setView] = useState<View>(hasAccounts ? "login" : "register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // 找回密码流程状态
  const [forgotAccount, setForgotAccount] = useState("");
  const [resetStep, setResetStep] = useState<"input" | "code">("input");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  // 账号栏折叠 + 删除账号
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const confirm = useConfirm();

  // 发送冷却倒计时（秒）。服务端有 60 秒冷却，这里同步倒计时，避免点了白报错。
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function switchView(v: View) {
    setView(v);
    setError("");
    setSuccess("");
    setResetStep("input");
    setResetCode("");
    setResetPassword("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<AuthState>(
          isPreview || view === "login" ? "/auth/login" : "/auth/setup",
          "POST",
          isPreview
            ? {}
            : {
                username,
                password,
                ...(view === "register" ? { name: name || username } : {}),
              },
        ),
      );
      setPassword("");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  // 步骤一：请求发送验证码
  async function sendResetCode() {
    if (busy || cooldown > 0) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const r = await api<{ ok: boolean; hint?: string }>("/auth/reset/request", "POST", {
        account: forgotAccount.trim(),
      });
      setSuccess(r.hint || "验证码已发送，请查收邮箱。");
      setResetStep("code");
      // 与服务端的 60 秒冷却对齐，倒计时结束前不再允许发送
      setCooldown(60);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  function requestResetCode(event: React.FormEvent) {
    event.preventDefault();
    void sendResetCode();
  }

  // 步骤二：验证验证码并重置密码
  async function confirmReset(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const r = await api<{ ok: boolean; message?: string }>("/auth/reset/confirm", "POST", {
        account: forgotAccount.trim(),
        code: resetCode.trim(),
        newPassword: resetPassword,
      });
      setSuccess(r.message || "密码已重置，请使用新密码登录。");
      // 重置成功后回到登录视图，并预填账号名
      setUsername(forgotAccount.trim());
      setPassword("");
      setView("login");
      setResetStep("input");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  /** 删除账号：弹一次确认框，确认后删除该账号及其全部数据。 */
  async function deleteAccount(a: Profile) {
    if (deletingBusy) return;
    const ok = await confirm(
      `确定删除账号「${a.name}」（${a.username}）吗？该账号及其全部数据将被永久删除，不可恢复。`,
      { title: "删除账号", confirmText: "确定删除", cancelText: "取消" },
    );
    if (!ok) return;
    setDeletingBusy(true);
    setError("");
    try {
      await api(`/account/${a.username}`, "DELETE");
      setSuccess(`账号「${a.name}」已删除。`);
      onLogin(await api<AuthState>("/auth/session"));
    } catch (e) {
      setError(message(e));
    } finally {
      setDeletingBusy(false);
    }
  }

  const isForgot = view === "forgot";

  return (
    <main className="login-shell">
      <section className="login-art">
        <div className="brand-lockup">
          <Layers3 size={28} />
          <span>
            AI 办公助手<small>INTELLIGENT WORKSPACE</small>
          </span>
        </div>
        <SceneCarousel login />
        <div className="login-story">
          <span className="eyebrow">THINK CLEAR. WORK SMART.</span>
          <h1>
            让想法连接知识。
            <br />
            让工作更进一步。
          </h1>
          <p>写作、知识与专注，在你的工作空间汇合。</p>
          <div className="login-pill-row">
            <span>智能写作</span>
            <span>个人知识库</span>
            <span>专注计时</span>
          </div>
        </div>
      </section>
      <section className="login-form-wrap">
        {isForgot ? (
          <form className="login-form light-frame-host" onSubmit={resetStep === "input" ? requestResetCode : confirmReset}>
            <LightFrame delay={2} />
            <button type="button" className="login-back" onClick={() => switchView("login")}>
              <ArrowLeft size={15} /> 返回登录
            </button>
            <span className="eyebrow">ACCOUNT RECOVERY</span>
            <h2>找回密码</h2>
            <p className="form-intro">
              {resetStep === "input"
                ? "输入你的账号名或已绑定的邮箱，我们将发送验证码。"
                : "输入邮箱收到的 6 位验证码，然后设置一个新密码。"}
            </p>
            <Notice error={error} success={success} />
            {resetStep === "input" ? (
              <>
                <Field label="账号或邮箱">
                  <input
                    value={forgotAccount}
                    onChange={(e) => setForgotAccount(e.target.value)}
                    required
                    minLength={3}
                    placeholder="输入账号名或绑定邮箱"
                  />
                </Field>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || cooldown > 0}
                  className="w-full"
                >
                  {busy ? "发送中…" : cooldown > 0 ? `请 ${cooldown} 秒后重试` : "发送验证码"}
                  <ArrowRight size={17} />
                </Button>
              </>
            ) : (
              <>
                <Field label="验证码">
                  <input
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    required
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 位数字验证码"
                  />
                </Field>
                <Field label="新密码">
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    placeholder={`至少 ${ACCOUNT.passwordMin} 位字符`}
                  />
                </Field>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    className="flex-1"
                    onClick={() => setResetStep("input")}
                  >
                    上一步
                  </Button>
                  <Button type="submit" variant="primary" disabled={busy} className="flex-1">
                    {busy ? "重置中…" : "重置密码"}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>没收到？检查一下垃圾邮件，或</span>
                  <button
                    type="button"
                    className="shrink-0 text-slate-700 underline underline-offset-2 disabled:opacity-50"
                    disabled={busy || cooldown > 0}
                    onClick={() => void sendResetCode()}
                  >
                    {cooldown > 0 ? `重新发送（${cooldown}s）` : "重新发送验证码"}
                  </button>
                </div>
              </>
            )}
            <p className="login-footnote">验证码 5 分钟内有效 · 请勿泄露给他人</p>
          </form>
        ) : (
          <form className="login-form light-frame-host" onSubmit={submit}>
            <LightFrame delay={2} />
            <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
            <h2>
              {isPreview ? "探索你的新工作台" : view === "register" ? "创建账号" : "欢迎回来"}
            </h2>
            <p className="form-intro">
              {isPreview
                ? "演示模式 · 无需注册即可体验全部页面"
                : view === "register"
                  ? state.accounts.length >= MAX_ACCOUNTS
                    ? `已达到 ${MAX_ACCOUNTS} 个账号上限，请先删除一个账号再注册。`
                    : "注册一个新的账号，数据彼此独立。"
                  : "登录后，继续你的工作与灵感。"}
            </p>
            <Notice error={error} />
            {isPreview ? (
              <div className="demo-account">
                <ShieldCheck size={24} />
                <div>
                  <strong>访客演示账号</strong>
                  <p>无需真实密码。个人资料和试填内容仅保留在当前浏览器，不会发送到服务器。</p>
                </div>
              </div>
            ) : (
              <>
                {hasAccounts && (
                  <div className="login-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === "login"}
                      className={view === "login" ? "is-active" : ""}
                      onClick={() => switchView("login")}
                    >
                      登录
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === "register"}
                      className={view === "register" ? "is-active" : ""}
                      disabled={state.accounts.length >= MAX_ACCOUNTS}
                      title={
                        state.accounts.length >= MAX_ACCOUNTS
                          ? `最多 ${MAX_ACCOUNTS} 个账号，请先删除一个`
                          : undefined
                      }
                      onClick={() => switchView("register")}
                    >
                      注册新账号
                    </button>
                  </div>
                )}
                <Field label="账号">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={40}
                    pattern="[a-zA-Z0-9_.\-]+"
                    placeholder="3–40 位字母、数字或 ._-"
                  />
                </Field>
                {view === "register" && (
                  <Field label="你的名字">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={60}
                      placeholder="在工作台中显示的名字"
                    />
                  </Field>
                )}
                <Field label="密码">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={view === "register" ? "new-password" : "current-password"}
                    required
                    minLength={8}
                    maxLength={128}
                    placeholder={`至少 ${ACCOUNT.passwordMin} 位字符`}
                  />
                </Field>
                {view === "login" && state.accounts.length > 0 && (
                  <div className="login-accounts">
                    <button
                      type="button"
                      className="account-toggle"
                      aria-expanded={accountsOpen}
                      onClick={() => setAccountsOpen((v) => !v)}
                    >
                      <UserRound size={16} />
                      <span>已保存的账号（{state.accounts.length}）</span>
                      {accountsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {accountsOpen && (
                      <div className="login-account-list">
                        {state.accounts.map((a) => (
                          <div className="login-account-chip" key={a.username}>
                            <button
                              type="button"
                              className="login-account-main"
                              onClick={() => setUsername(a.username)}
                            >
                              <span className="avatar-small">{a.name.slice(0, 1)}</span>
                              <span>
                                <strong>{a.name}</strong>
                                <small>{a.username}</small>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="account-delete"
                              aria-label={`删除账号 ${a.name}`}
                              title="删除账号"
                              disabled={deletingBusy}
                              onClick={() => void deleteAccount(a)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              {busy
                ? "正在进入…"
                : isPreview
                  ? "进入演示工作台"
                  : view === "register"
                    ? "创建并进入"
                    : "登录工作台"}
              <ArrowRight size={17} />
            </Button>
            {!isPreview && view === "login" && (
              <button
                type="button"
                className="login-forgot"
                onClick={() => {
                  switchView("forgot");
                  setForgotAccount(username);
                }}
              >
                忘记密码？
              </button>
            )}
            <p className="login-footnote">
              {isPreview
                ? "演示数据仅保存在当前浏览器"
                : "多账号工作空间 · 密码加密保存 · 资料留在本机"}
            </p>
          </form>
        )}
        <span className="login-version">AI OFFICE / WORKSPACE 02</span>
      </section>
    </main>
  );
}
