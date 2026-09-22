import { useState } from "react";
import { ArrowRight, Layers3, ShieldCheck } from "lucide-react";
import type { AuthState } from "../../shared/types";
import { LightFrame } from "../components/LightFrame";
import { SceneCarousel } from "../components/SceneCarousel";
import { Button, Field, Notice } from "../components/ui";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";

export function Login({
  state,
  onLogin,
}: {
  state: AuthState;
  onLogin: (state: AuthState) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<AuthState>(
          isPreview ? "/auth/login" : state.setupRequired ? "/auth/setup" : "/auth/login",
          "POST",
          isPreview
            ? {}
            : {
                username,
                password,
                ...(state.setupRequired ? { name: name || username } : {}),
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
        <form className="login-form light-frame-host" onSubmit={submit}>
          <LightFrame delay={2} />
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>
            {isPreview ? "探索你的新工作台" : state.setupRequired ? "创建你的工作空间" : "欢迎回来"}
          </h2>
          <p className="form-intro">
            {isPreview
              ? "演示模式 · 无需注册即可体验全部页面"
              : state.setupRequired
                ? "首次使用，设置一个属于你的账号。"
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
              {state.setupRequired && (
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
                  autoComplete={state.setupRequired ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  maxLength={128}
                  placeholder="至少 8 位字符"
                />
              </Field>
            </>
          )}
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy
              ? "正在进入…"
              : isPreview
                ? "进入演示工作台"
                : state.setupRequired
                  ? "创建并进入"
                  : "登录工作台"}
            <ArrowRight size={17} />
          </Button>
          <p className="login-footnote">
            {isPreview
              ? "演示数据仅保存在当前浏览器"
              : "单人工作空间 · 密码加密保存 · 资料留在本机"}
          </p>
        </form>
        <span className="login-version">AI OFFICE / WORKSPACE 02</span>
      </section>
    </main>
  );
}
