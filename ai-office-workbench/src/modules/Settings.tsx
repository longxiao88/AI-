import { useEffect, useState } from "react";
import { Mail, PlugZap, ShieldCheck } from "lucide-react";
import type { Settings as Config } from "../../shared/types";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";
import { useBusy } from "../lib/useBusy";

interface SmtpState {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  configured: boolean;
  /** 由环境变量接管，界面改为只读 */
  managedByEnv: boolean;
}

export function Settings({
  onDirty,
  onBusy,
  onGoBindEmail,
}: {
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
  /** 保存邮件配置成功后，用户选择前往个人资料绑定邮箱 */
  onGoBindEmail: () => void;
}) {
  const [saved, setSaved] = useState<Config | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, run] = useBusy(onBusy);
  const confirm = useConfirm();

  // SMTP 配置
  const [smtp, setSmtp] = useState<SmtpState | null>(null);
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpError, setSmtpError] = useState("");
  const [smtpSuccess, setSmtpSuccess] = useState("");

  // 密钥输入框有内容也算未保存
  const dirty = !!saved && (baseUrl !== saved.baseUrl || model !== saved.model || !!key);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  useEffect(() => {
    api<Config>("/settings")
      .then((value) => {
        setSaved(value);
        setBaseUrl(value.baseUrl);
        setModel(value.model);
      })
      .catch((e) => setError(message(e)));
  }, []);

  useEffect(() => {
    if (isPreview) return;
    api<SmtpState>("/settings/smtp")
      .then(setSmtp)
      .catch(() => {});
  }, []);

  async function saveSettings() {
    if (!baseUrl.trim() || !model.trim()) throw Error("请填写 API 地址和模型名称。");
    const value = await api<Config>("/settings", "PUT", {
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      // 留空表示沿用当前密钥
      ...(key ? { key } : {}),
    });
    setSaved(value);
    setBaseUrl(value.baseUrl);
    setModel(value.model);
    setKey("");
  }

  async function action(type: "save" | "test" | "clear") {
    if (busy || isPreview) return;
    if (
      type === "clear" &&
      !(await confirm("清除后需要重新填写 API Key 才能调用 AI。确认清除吗？"))
    )
      return;

    setError("");
    setSuccess("");
    await run(async () => {
      try {
        if (type === "clear") {
          setSaved(await api<Config>("/settings/key", "DELETE"));
          setKey("");
          setSuccess("密钥已清除。");
        } else if (type === "test") {
          await saveSettings();
          await api("/ai/test", "POST");
          setSuccess("连接成功，模型已返回有效文本。");
        } else {
          await saveSettings();
          setSuccess("设置已保存。密钥仅在本次运行期间有效。");
        }
      } catch (e) {
        setError(message(e));
      }
    });
  }

  async function saveSmtp() {
    if (busy || isPreview || !smtp || smtp.managedByEnv) return;
    if (!smtp.host.trim() || !smtp.user.trim())
      return setSmtpError("请填写 SMTP 服务器和发件账号。");
    setSmtpError("");
    setSmtpSuccess("");
    let ok = false;
    await run(async () => {
      try {
        const value = await api<SmtpState>("/settings/smtp", "PUT", {
          host: smtp.host.trim(),
          port: smtp.port,
          secure: smtp.secure,
          user: smtp.user.trim(),
          fromName: smtp.fromName.trim(),
          // 留空表示沿用当前授权码
          ...(smtpPass ? { pass: smtpPass } : {}),
        });
        setSmtp(value);
        setSmtpPass("");
        setSmtpSuccess("邮件服务配置已保存。");
        ok = true;
      } catch (e) {
        setSmtpError(message(e));
      }
    });
    if (!ok) return;

    // 必须等 run 结束再询问：外层在 busy 期间会拦截页面跳转
    const go = await confirm(
      "邮件服务已保存。是否现在前往「个人资料」绑定邮箱？绑定并验证后才能收到验证码，也可以用它找回密码。",
      { title: "配置已保存", confirmText: "去绑定邮箱", cancelText: "稍后再说" },
    );
    if (go) onGoBindEmail();
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid gap-6">
      <section className="panel grid gap-6 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-50 p-3 text-blue-700">
            <PlugZap size={22} />
          </div>
          <div>
            <h2 className="font-semibold">AI 服务连接</h2>
            <p className="mt-1 text-sm text-slate-500">支持 OpenAI 兼容的对话接口</p>
          </div>
        </div>
        <Notice error={error} success={success} />
        {isPreview && (
          <p className="rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-800">
            演示模式下不接收 API Key，本机运行完整版后即可配置模型。
          </p>
        )}
        <Field
          label="API 地址"
          hint="填写接口基础地址，如 https://api.openai.com/v1，不要包含 /chat/completions。"
        >
          <input
            type="url"
            disabled={busy || !saved || isPreview}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
        <Field label="模型名称" hint="使用服务商提供的准确模型标识。">
          <input
            disabled={busy || !saved || isPreview}
            value={model}
            maxLength={120}
            onChange={(e) => setModel(e.target.value)}
            placeholder="输入模型名称"
          />
        </Field>
        <Field
          label="API Key"
          hint={
            saved?.hasKey ? "已有密钥保存在本次运行中；留空保留，填写可替换。" : "尚未配置密钥。"
          }
        >
          <input
            type="password"
            autoComplete="off"
            disabled={busy || !saved || isPreview}
            value={key}
            maxLength={2048}
            onChange={(e) => setKey(e.target.value)}
            placeholder="填写你的 API Key"
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={busy || !saved || isPreview}
            onClick={() => void action("save")}
          >
            {busy ? "处理中…" : "保存设置"}
          </Button>
          <Button disabled={busy || !saved || isPreview} onClick={() => void action("test")}>
            保存并测试连接
          </Button>
          {saved?.hasKey && (
            <Button variant="danger" disabled={busy} onClick={() => void action("clear")}>
              清除密钥
            </Button>
          )}
        </div>
        <p className="text-xs leading-6 text-slate-500">
          测试连接会向所填服务商发送一条简短请求，可能产生少量调用费用。
        </p>
      </section>
      <section className="panel grid gap-6 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
            <Mail size={22} />
          </div>
          <div>
            <h2 className="font-semibold">邮件服务（SMTP）</h2>
            <p className="mt-1 text-sm text-slate-500">用于发送账号找回与邮箱验证码</p>
          </div>
        </div>
        {isPreview ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
            演示模式不支持邮件服务。
          </p>
        ) : smtp ? (
          <>
            <Notice error={smtpError} success={smtpSuccess} />
            {smtp.managedByEnv && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                当前由环境变量（SMTP_HOST / SMTP_USER / SMTP_PASS 等）接管，授权码不经过数据库。
                下面的信息仅供查看，修改环境变量后重启服务即可生效。
              </p>
            )}
            <Field
              label="SMTP 服务器"
              hint="如 smtp.qq.com、smtp.163.com、smtp.exmail.qq.com"
            >
              <input
                disabled={busy || smtp.managedByEnv}
                value={smtp.host}
                onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                placeholder="smtp.example.com"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="端口">
                <input
                  type="number"
                  disabled={busy || smtp.managedByEnv}
                  value={smtp.port}
                  onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}
                />
              </Field>
              <Field label="连接方式">
                <select
                  disabled={busy || smtp.managedByEnv}
                  value={smtp.secure ? "ssl" : "starttls"}
                  onChange={(e) => setSmtp({ ...smtp, secure: e.target.value === "ssl" })}
                >
                  <option value="ssl">SSL（端口 465）</option>
                  <option value="starttls">STARTTLS（端口 587）</option>
                </select>
              </Field>
            </div>
            <Field label="发件账号">
              <input
                disabled={busy || smtp.managedByEnv}
                value={smtp.user}
                onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
                placeholder="you@example.com"
              />
            </Field>
            <Field label="发件人名称（可选）">
              <input
                disabled={busy || smtp.managedByEnv}
                maxLength={60}
                value={smtp.fromName}
                onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })}
                placeholder="AI 办公助手"
              />
            </Field>
            <Field
              label="授权码 / 密码"
              hint={
                smtp.managedByEnv
                  ? "由环境变量提供，界面上不保存也不显示。"
                  : smtp.configured
                    ? "已加密保存授权码；留空保留，填写可替换。"
                    : "尚未配置授权码。"
              }
            >
              <input
                type="password"
                disabled={busy || smtp.managedByEnv}
                autoComplete="off"
                value={smtpPass}
                maxLength={2048}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={smtp.managedByEnv ? "由环境变量提供" : "邮箱的 SMTP 授权码"}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                disabled={busy || smtp.managedByEnv}
                onClick={() => void saveSmtp()}
              >
                {busy ? "保存中…" : "保存邮件配置"}
              </Button>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              授权码通常需在邮箱服务商开启 SMTP 服务后获取，而非登录密码。填在这里的授权码会用
              AES-256-GCM 加密后再存入本机数据库，密钥单独保存在 data 目录的密钥文件中；也可以改用
              SMTP_PASS 等环境变量提供，那样完全不落库。
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">加载中…</p>
        )}
      </section>
      </div>
      <aside className="panel h-fit p-5">
        <ShieldCheck size={24} className="mb-4 text-slate-500" />
        <h2 className="font-semibold">{isPreview ? "关于演示模式" : "只在本机使用"}</h2>
        <div className="mt-3 space-y-4 text-sm leading-7 text-slate-500">
          <p>
            {isPreview
              ? "演示中的修改只保存在当前浏览器，不会上传到服务器或影响其他访客。"
              : "文稿和项目保存于本机。使用 AI 时，当前输入会发送给你配置的服务商。"}
          </p>
          <p>API Key 不写入资料库；关闭或重启后端服务后，请重新填写。</p>
          <p>没有密钥也可以整理会议、项目和文档。</p>
        </div>
      </aside>
    </div>
  );
}
