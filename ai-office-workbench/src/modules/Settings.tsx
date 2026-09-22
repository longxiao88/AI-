import { useEffect, useState } from "react";
import { PlugZap, ShieldCheck } from "lucide-react";
import type { Settings as Config } from "../../shared/types";
import { Button, Field, Notice, useConfirm } from "../components/ui";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";
import { useBusy } from "../lib/useBusy";

export function Settings({
  onDirty,
  onBusy,
}: {
  onDirty: (v: boolean) => void;
  onBusy: (v: boolean) => void;
}) {
  const [saved, setSaved] = useState<Config | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, run] = useBusy(onBusy);
  const confirm = useConfirm();

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

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
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
