import type { ReactNode } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { WorkspaceEditor } from "../lib/editor";
import { Button, Field, Notice, cn } from "./ui";
import { useI18n } from "../lib/i18n";

export function Workspace({
  editor: e,
  children,
  label,
  busy = false,
}: {
  editor: WorkspaceEditor;
  children: ReactNode;
  label: string;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold">{t("ws.title", { label })}</h2>
          <Button
            aria-label={t("ws.new", { label })}
            disabled={busy || e.saving || e.loading}
            className="px-2 py-2"
            onClick={() => void e.select(null)}
          >
            <Plus size={16} />
          </Button>
        </div>
        <div className="max-h-64 overflow-auto p-2 xl:max-h-[36rem]">
          {e.loading ? (
            <p className="p-4 text-sm text-slate-500">{t("common.loading")}</p>
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
              {t("ws.empty", { label })}
              <br />
              {t("ws.emptyHint")}
            </p>
          )}
        </div>
      </aside>
      <section className="panel min-w-0 p-5 sm:p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">
            {e.current ? t("common.edit") : t("common.new")}
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
              {e.saving ? t("common.saving") : "保存"}
            </Button>
          </div>
        </div>
        <div className="grid gap-5">
          <Notice error={e.error} success={e.success} />
          <Field label={t("common.title")}>
            <input
              value={e.title}
              disabled={busy || e.saving || e.loading}
              maxLength={120}
              onChange={(event) => e.setTitle(event.target.value)}
              placeholder={t("ws.titlePlaceholder", { label })}
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
