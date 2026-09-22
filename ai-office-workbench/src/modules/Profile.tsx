import { useEffect, useState } from "react";
import type { Profile as ProfileData } from "../../shared/types";
import { Button, Field, Notice } from "../components/ui";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";

export function Profile({
  user,
  onUpdate,
  onDirty,
}: {
  user: ProfileData;
  onUpdate: (u: ProfileData) => void;
  onDirty: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState(user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => onDirty(JSON.stringify(draft) !== JSON.stringify(user)), [draft, user, onDirty]);

  async function save() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const { username, ...body } = draft;
      const value = await api<ProfileData>("/profile", "PUT", body);
      onUpdate(value);
      setDraft(value);
      setSuccess(isPreview ? "演示资料已保存在当前浏览器。" : "个人资料已保存。");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-grid">
      <aside className="panel profile-summary">
        <div className="avatar-large">{draft.name.slice(0, 1) || "U"}</div>
        <h2>{draft.name || "你的名字"}</h2>
        <p>{draft.role || "个人工作空间"}</p>
        <span className="eyebrow">PROFILE / {user.username}</span>
      </aside>
      <section className="panel p-6">
        <h2 className="mb-6 text-lg font-semibold">你的个人资料</h2>
        <div className="grid gap-5">
          <Notice error={error} success={success} />
          <fieldset disabled={busy} className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="显示名称">
                <input
                  maxLength={60}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="身份 / 职位">
                <input
                  maxLength={80}
                  value={draft.role}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                  placeholder="例如：学生、设计师"
                />
              </Field>
            </div>
            <Field label="邮箱">
              <input
                type="email"
                maxLength={120}
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="选填，用于记录个人资料"
              />
            </Field>
            <Field label="个人简介">
              <textarea
                rows={5}
                maxLength={500}
                value={draft.bio}
                onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
                placeholder="记录你的研究方向、工作习惯或当前目标…"
              />
            </Field>
          </fieldset>
          <Button
            variant="primary"
            className="justify-self-start"
            disabled={busy || !draft.name.trim()}
            onClick={() => void save()}
          >
            {busy ? "保存中…" : "保存个人资料"}
          </Button>
        </div>
      </section>
    </div>
  );
}
