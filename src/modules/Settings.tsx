import { useEffect, useState } from "react";
import { Mail, PlugZap, ShieldCheck } from "lucide-react";
import type { Settings as Config } from "../../shared/types";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";
import { useBusy } from "../lib/useBusy";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
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
    if (!baseUrl.trim() || !model.trim()) throw Error(t("settings.needApi"));
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
      !(await confirm(t("settings.clearConfirm")))
    )
      return;

    setError("");
    setSuccess("");
    await run(async () => {
      try {
        if (type === "clear") {
          setSaved(await api<Config>("/settings/key", "DELETE"));
          setKey("");
          setSuccess(t("settings.keyCleared"));
        } else if (type === "test") {
          await saveSettings();
          await api("/ai/test", "POST");
          setSuccess(t("settings.connectOk"));
        } else {
          await saveSettings();
          setSuccess(t("settings.savedKeySession"));
        }
      } catch (e) {
        setError(message(e));
      }
    });
  }

  async function saveSmtp() {
    if (busy || isPreview || !smtp || smtp.managedByEnv) return;
    if (!smtp.host.trim() || !smtp.user.trim())
      return setSmtpError(t("settings.needSmtp"));
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
        setSmtpSuccess(t("settings.mailSaved"));
        ok = true;
      } catch (e) {
        setSmtpError(message(e));
      }
    });
    if (!ok) return;

    // 必须等 run 结束再询问：外层在 busy 期间会拦截页面跳转
    const go = await confirm(
      t("settings.mailSavedAsk"),
      { title: t("settings.saved"), confirmText: t("settings.bindMail"), cancelText: t("settings.later") },
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
            <h2 className="font-semibold">{t("settings.aiTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("settings.aiCompat")}</p>
          </div>
        </div>
        <Notice error={error} success={success} />
        {isPreview && (
          <p className="rounded-lg bg-blue-50 p-3 text-sm leading-6 text-blue-800">
            演示模式下不接收 API Key，本机运行完整版后即可配置模型。
          </p>
        )}
        <Field
          label={t("settings.apiUrl")}
          hint={t("settings.apiUrlHint")}
        >
          <input
            type="url"
            disabled={busy || !saved || isPreview}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
        <Field label={t("settings.model")} hint={t("settings.modelHint")}>
          <input
            disabled={busy || !saved || isPreview}
            value={model}
            maxLength={120}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("settings.modelPlaceholder")}
          />
        </Field>
        <Field
          label="API Key"
          hint={
            saved?.hasKey ? t("settings.keySaved") : t("settings.noKey")
          }
        >
          <input
            type="password"
            autoComplete="off"
            disabled={busy || !saved || isPreview}
            value={key}
            maxLength={2048}
            onChange={(e) => setKey(e.target.value)}
            placeholder={t("settings.keyPlaceholder")}
          />
        </Field>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="primary"
            disabled={busy || !saved || isPreview}
            onClick={() => void action("save")}
          >
            {busy ? t("settings.working") : t("settings.save")}
          </Button>
          <Button disabled={busy || !saved || isPreview} onClick={() => void action("test")}>
            {t("settings.saveTest")}
          </Button>
          {saved?.hasKey && (
            <Button variant="danger" disabled={busy} onClick={() => void action("clear")}>
              清除密钥
            </Button>
          )}
        </div>
        <p className="text-xs leading-6 text-slate-500">
          {t("settings.testHint")}
        </p>
      </section>
      <section className="panel grid gap-6 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
            <Mail size={22} />
          </div>
          <div>
            <h2 className="font-semibold">{t("settings.mailTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("settings.mailPurpose")}</p>
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
              label={t("settings.smtpHost")}
              hint={t("settings.smtpPlaceholder")}
            >
              <input
                disabled={busy || smtp.managedByEnv}
                value={smtp.host}
                onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
                placeholder="smtp.example.com"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("settings.port")}>
                <input
                  type="number"
                  disabled={busy || smtp.managedByEnv}
                  value={smtp.port}
                  onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })}
                />
              </Field>
              <Field label={t("settings.connectMode")}>
                <select
                  disabled={busy || smtp.managedByEnv}
                  value={smtp.secure ? "ssl" : "starttls"}
                  onChange={(e) => setSmtp({ ...smtp, secure: e.target.value === "ssl" })}
                >
                  <option value="ssl">{t("settings.ssl")}</option>
                  <option value="starttls">{t("settings.starttls")}</option>
                </select>
              </Field>
            </div>
            <Field label={t("settings.fromAccount")}>
              <input
                disabled={busy || smtp.managedByEnv}
                value={smtp.user}
                onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
                placeholder="you@example.com"
              />
            </Field>
            <Field label={t("settings.fromName")}>
              <input
                disabled={busy || smtp.managedByEnv}
                maxLength={60}
                value={smtp.fromName}
                onChange={(e) => setSmtp({ ...smtp, fromName: e.target.value })}
                placeholder="AIpharis Muse"
              />
            </Field>
            <Field
              label={t("settings.authCode")}
              hint={
                smtp.managedByEnv
                  ? t("settings.fromEnvHidden")
                  : smtp.configured
                    ? t("settings.authSaved")
                    : t("settings.noAuth")
              }
            >
              <input
                type="password"
                disabled={busy || smtp.managedByEnv}
                autoComplete="off"
                value={smtpPass}
                maxLength={2048}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder={smtp.managedByEnv ? t("settings.fromEnv") : t("settings.authPlaceholder")}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                disabled={busy || smtp.managedByEnv}
                onClick={() => void saveSmtp()}
              >
                {busy ? t("settings.saving") : t("settings.saveMail")}
              </Button>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              授权码通常需在邮箱服务商开启 SMTP 服务后获取，而非登录密码。填在这里的授权码会用
              AES-256-GCM 加密后再存入本机数据库，密钥单独保存在 data 目录的密钥文件中；也可以改用
              SMTP_PASS 等环境变量提供，那样完全不落库。
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">{t("settings.loading")}</p>
        )}
      </section>
      </div>
      <aside className="panel h-fit p-5">
        <ShieldCheck size={24} className="mb-4 text-slate-500" />
        <h2 className="font-semibold">{isPreview ? t("settings.demoTitle") : t("settings.localOnly")}</h2>
        <div className="mt-3 space-y-4 text-sm leading-7 text-slate-500">
          <p>
            {isPreview
              ? t("settings.demoNote")
              : t("settings.privacy")}
          </p>
          <p>{t("settings.keyHint")}</p>
          <p>{t("settings.noKeyNote")}</p>
        </div>
      </aside>
    </div>
  );
}
