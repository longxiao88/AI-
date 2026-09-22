import type { ReactNode } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { Editor } from "../lib/editor";
import { Button, Empty, Field, Notice, cn } from "./ui";

export function Workspace({
  editor: e,
  children,
  label,
  busy = false,
}: {
  editor: Editor;
  children: ReactNode;
  label: string;
  busy?: boolean;
}) {
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold">我的{label}</h2>
          <Button
            aria-label={`新建${label}`}
            disabled={busy || e.saving || e.loading}
            className="px-2 py-2"
            onClick={() => void e.select(null)}
          >
            <Plus size={16} />
          </Button>
        </div>
        <div className="max-h-64 overflow-auto p-2 xl:max-h-[36rem]">
          {e.loading ? (
            <p className="p-4 text-sm text-slate-500">正在读取…</p>
          ) : e.items.length ? (
            e.items.map((item) => (
              <button
                disabled={busy || e.saving || e.loading}
                key={item.id}
                onClick={() => void e.select(item)}
                className={cn(
                  "mb-1 block w-full rounded-lg p-3 text-left hover:bg-slate-50",
                  e.current?.id === item.id && "bg-blue-50 text-blue-700",
                )}
              >
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="mt-1 block text-xs text-slate-500 tabular-nums">
                  {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                </span>
              </button>
            ))
          ) : (
            <p className="p-4 text-sm leading-6 text-slate-500">
              还没有保存的{label}。<br />
              填写内容，保存第一条记录。
            </p>
          )}
        </div>
      </aside>
      <section className="panel min-w-0 p-5 sm:p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">
            {e.current ? "编辑" : "新建"}
            {label}
          </h2>
          <div className="flex gap-2">
            {e.current && (
              <Button
                variant="danger"
                disabled={busy || e.saving || e.loading}
                onClick={() => void e.remove()}
              >
                <Trash2 size={15} />
                删除
              </Button>
            )}
            <Button
              variant="primary"
              disabled={busy || e.saving || e.loading}
              onClick={() => void e.save()}
            >
              <Save size={15} />
              {e.saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
        <div className="grid gap-5">
          <Notice error={e.error} success={e.success} />
          <Field label="标题">
            <input
              value={e.title}
              disabled={busy || e.saving || e.loading}
              maxLength={120}
              onChange={(event) => e.setTitle(event.target.value)}
              placeholder={`给这份${label}起个名字`}
            />
          </Field>
          <fieldset disabled={e.saving || e.loading} className="grid min-w-0 gap-5">
            {children}
          </fieldset>
        </div>
      </section>
    </div>
  );
}
