import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Mail } from "lucide-react";
import type { Profile as ProfileData } from "../../shared/types";
import { Button, cn, Field, Notice } from "../components/ui";
import { api, message, type ApiFailure } from "../lib/api";
import { isPreview } from "../lib/runtime";
import { useI18n } from "../lib/i18n";

export function Profile({
  user,
  onUpdate,
  onDirty,
  focusEmail = false,
}: {
  user: ProfileData;
  onUpdate: (u: ProfileData) => void;
  onDirty: (v: boolean) => void;
  /** 从设置页跳转而来，需要提示用户填写邮箱 */
  focusEmail?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  /** 逐字段的校验提示：有值就标红对应输入框并提示，用户重新输入即清掉 */
  type FieldKey = "name" | "role" | "bio";
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  // 邮箱绑定流程
  const [emailDraft, setEmailDraft] = useState(user.email || "");
  const [emailStep, setEmailStep] = useState<"idle" | "code">("idle");
  const [emailCode, setEmailCode] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [emailSuccess, setEmailSuccess] = useState("");

  // 从设置页跳转过来时，标红邮箱输入框，用户一开始填写就取消提示
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [highlightEmail, setHighlightEmail] = useState(false);

  useEffect(() => {
    if (!focusEmail) return;
    setHighlightEmail(true);
    // 等页面挂载并滚动到可视区域后再聚焦，避免 focus 把页面拉回顶部
    const timer = window.setTimeout(() => {
      const input = emailInputRef.current;
      if (!input) return;
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      input.focus({ preventScroll: true });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusEmail]);

  // 发送冷却倒计时（与服务端的 60 秒冷却一致）
  const [emailCooldown, setEmailCooldown] = useState(0);
  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = window.setTimeout(() => setEmailCooldown((v) => v - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCooldown]);

  useEffect(() => onDirty(JSON.stringify(draft) !== JSON.stringify(user)), [draft, user, onDirty]);

  function clearFieldError(key: FieldKey) {
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  /** 提交前本地校验，规则与服务端 profileSchema 保持一致 */
  function validateDraft(next: typeof draft) {
    const found: Partial<Record<FieldKey, string>> = {};
    const name = next.name.trim();
    if (!name) found.name = t("profile.nameEmpty");
    else if (name.length > 60) found.name = t("profile.nameLimit", { max: 60, n: name.length });
    if ((next.role ?? "").length > 80) found.role = t("profile.nameLimit", { max: 80, n: next.role.length });
    if ((next.bio ?? "").length > 500) found.bio = t("profile.nameLimit", { max: 500, n: next.bio.length });
    return found;
  }

  async function save() {
    const problems = validateDraft(draft);
    if (Object.keys(problems).length) {
      setFieldErrors(problems);
      setError("");
      setSuccess("");
      return;
    }

    setFieldErrors({});
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      // 只提交 schema 认识的四个字段（多一个都会被 .strict() 拒掉）；
      // 邮箱走下面的验证码流程，这里只回传当前已验证的值
      const body = {
        name: draft.name.trim(),
        email: user.email ?? "",
        role: draft.role ?? "",
        bio: draft.bio ?? "",
      };
      const value = await api<ProfileData>("/profile", "PUT", body);
      onUpdate(value);
      setDraft(value);
      setSuccess(isPreview ? t("profile.demoSaved") : t("profile.saved"));
    } catch (e) {
      const issues = (e as ApiFailure).fields;
      const mapped: Partial<Record<FieldKey, string>> = {};
      for (const issue of issues ?? []) {
        if (issue.path === "name") mapped.name = t("profile.fmt60");
        else if (issue.path === "role") mapped.role = t("profile.fmt80");
        else if (issue.path === "bio") mapped.bio = t("profile.fmt500");
      }
      if (Object.keys(mapped).length) {
        // 能定位到具体字段就不再显示笼统提示
        setFieldErrors(mapped);
        setError("");
      } else {
        setError(message(e));
      }
    } finally {
      setBusy(false);
    }
  }

  // 请求发送邮箱验证码
  async function requestEmailCode() {
    if (emailBusy || emailCooldown > 0) return;
    setEmailBusy(true);
    setEmailError("");
    setEmailSuccess("");
    try {
      await api("/profile/email/request", "POST", { email: emailDraft.trim() });
      setEmailStep("code");
      setEmailSuccess(t("profile.codeSent"));
      setEmailCooldown(60);
    } catch (e) {
      setEmailError(message(e));
    } finally {
      setEmailBusy(false);
    }
  }

  // 验证验证码并绑定邮箱
  async function confirmEmail() {
    if (emailBusy) return;
    setEmailBusy(true);
    setEmailError("");
    setEmailSuccess("");
    try {
      const value = await api<ProfileData>("/profile/email/confirm", "POST", {
        email: emailDraft.trim(),
        code: emailCode.trim(),
      });
      onUpdate(value);
      setDraft(value);
      setEmailDraft(value.email || "");
      setEmailStep("idle");
      setEmailCode("");
      setEmailSuccess(t("profile.mailVerified"));
    } catch (e) {
      setEmailError(message(e));
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <div className="profile-grid">
      <aside className="panel profile-summary">
        <div className="avatar-large">{draft.name.slice(0, 1) || "U"}</div>
        <h2>{draft.name || t("profile.namePlaceholder")}</h2>
        <p>{draft.role || t("profile.personal")}</p>
        <span className="eyebrow">PROFILE / {user.username}</span>
      </aside>
      <section className="panel p-6">
        <h2 className="mb-6 text-lg font-semibold">{t("profile.title")}</h2>
        <div className="grid gap-5">
          <Notice error={error} success={success} />
          <fieldset disabled={busy} className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t("profile.displayName")} error={fieldErrors.name}>
                <input
                  maxLength={60}
                  value={draft.name}
                  aria-invalid={fieldErrors.name ? true : undefined}
                  onChange={(e) => {
                    setDraft({ ...draft, name: e.target.value });
                    clearFieldError("name");
                  }}
                />
              </Field>
              <Field label={t("profile.role")} error={fieldErrors.role}>
                <input
                  maxLength={80}
                  value={draft.role}
                  onChange={(e) => {
                    setDraft({ ...draft, role: e.target.value });
                    clearFieldError("role");
                  }}
                  placeholder={t("profile.rolePlaceholder")}
                />
              </Field>
            </div>
            <Field label={t("profile.bio")} error={fieldErrors.bio}>
              <textarea
                rows={5}
                maxLength={500}
                value={draft.bio}
                onChange={(e) => {
                  setDraft({ ...draft, bio: e.target.value });
                  clearFieldError("bio");
                }}
                placeholder={t("profile.bioPlaceholder")}
              />
            </Field>
          </fieldset>
          <Button
            variant="primary"
            className="justify-self-start"
            disabled={busy || !draft.name.trim()}
            onClick={() => void save()}
          >
            {busy ? t("profile.saving") : t("profile.save")}
          </Button>
        </div>

        {/* 邮箱绑定（用于找回密码） */}
        <div className="mt-8 border-t border-slate-200 pt-6">
          <div className="mb-3 flex items-center gap-2">
            <Mail size={17} className="text-slate-500" />
            <h3 className="font-semibold">{t("profile.accountMail")}</h3>
            {user.emailVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                <CheckCircle2 size={13} /> 已验证
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                {t("profile.unbound")}
              </span>
            )}
          </div>
          <p
            className={cn(
              "mb-4 text-sm leading-6",
              highlightEmail ? "font-medium text-red-600" : "text-slate-500",
            )}
          >
            {highlightEmail
              ? t("profile.bindHint")
              : t("profile.mailNote")}
          </p>
          {isPreview ? (
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
              演示模式不支持邮箱绑定。
            </p>
          ) : (
            <div className="grid gap-4">
              <Notice error={emailError} success={emailSuccess} />
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Field label={emailStep === "idle" ? t("profile.mail") : t("profile.verifyMail")}>
                  <input
                    ref={emailInputRef}
                    type="email"
                    maxLength={120}
                    value={emailDraft}
                    disabled={emailStep === "code"}
                    className={highlightEmail ? "field-highlight" : undefined}
                    aria-invalid={highlightEmail || undefined}
                    onChange={(e) => {
                      setEmailDraft(e.target.value);
                      // 一开始输入就撤掉红色提示
                      if (highlightEmail) setHighlightEmail(false);
                    }}
                    placeholder="name@example.com"
                  />
                </Field>
                {emailStep === "idle" ? (
                  <Button
                    className="self-end"
                    disabled={emailBusy || emailCooldown > 0 || !emailDraft.trim()}
                    onClick={() => void requestEmailCode()}
                  >
                    {emailBusy
                      ? t("profile.sending")
                      : emailCooldown > 0
                        ? t("profile.retryIn", { n: emailCooldown })
                        : t("profile.sendCode")}
                  </Button>
                ) : (
                  <>
                    <Field label={t("profile.code")}>
                      <div className="flex gap-2">
                        <input
                          value={emailCode}
                          onChange={(e) => setEmailCode(e.target.value)}
                          inputMode="numeric"
                          maxLength={6}
                          placeholder={t("profile.code6")}
                        />
                        <Button
                          disabled={emailBusy || emailCode.trim().length !== 6}
                          onClick={() => void confirmEmail()}
                        >
                          {emailBusy ? t("profile.verifying") : t("profile.verify")}
                        </Button>
                      </div>
                    </Field>
                    <button
                      type="button"
                      className="self-end justify-self-start text-xs text-slate-600 underline underline-offset-2 disabled:opacity-50"
                      disabled={emailBusy || emailCooldown > 0}
                      onClick={() => void requestEmailCode()}
                    >
                      {emailCooldown > 0 ? t("profile.resendIn", { n: emailCooldown }) : t("profile.resend")}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
