import { useEffect, useState } from "react";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { AI_INPUT_LIMIT, type ProjectResult } from "../../shared/ai-schemas";
import type { Task, TaskStatus } from "../../shared/types";
import { Button, Empty, Field, Notice, useConfirm } from "../components/ui";
import { Workspace } from "../components/Workspace";
import { api, message } from "../lib/api";
import { useEditor, type ModuleProps } from "../lib/editor";
import { useBusy } from "../lib/useBusy";
import { useI18n, type Translate } from "../lib/i18n";

/** 模块级常量拿不到 hook，所以做成函数，由组件把 t 传进来 */
const statuses = (t: Translate): Record<TaskStatus, string> => ({
  todo: t("projects.todo"),
  doing: t("projects.doing"),
  done: t("projects.done"),
});

function TaskBoard({ projectId, onDirty }: { projectId: string; onDirty: (v: boolean) => void }) {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [editing, setEditing] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirm = useConfirm();

  const dirty = title !== (editing?.title || "") || status !== (editing?.status || "todo");

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  useEffect(() => () => onDirty(false), [onDirty]);

  useEffect(() => {
    let active = true;
    api<Task[]>(`/projects/${projectId}/tasks`)
      .then((rows) => active && setTasks(rows))
      .catch((e) => active && setError(message(e)));
    return () => {
      active = false;
    };
  }, [projectId]);

  function resetForm(task: Task | null = null) {
    setEditing(task);
    setTitle(task?.title || "");
    setStatus(task?.status || "todo");
  }

  async function save() {
    if (busy) return;
    if (!title.trim()) return setError(t("projects.needTaskName"));

    setBusy(true);
    setError("");
    try {
      if (editing)
        await api(`/projects/${projectId}/tasks/${editing.id}`, "PUT", { title, status });
      else await api(`/projects/${projectId}/tasks`, "POST", { title, status });
      setTasks(await api<Task[]>(`/projects/${projectId}/tasks`));
      resetForm();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function edit(task: Task | null) {
    if (dirty && !(await confirm(t("projects.taskDiscardConfirm")))) return;
    resetForm(task);
    setError("");
  }

  async function remove(task: Task) {
    if (!(await confirm(t("projects.deleteConfirm")))) return;
    setBusy(true);
    try {
      await api(`/projects/${projectId}/tasks/${task.id}`, "DELETE");
      setTasks(tasks.filter((t) => t.id !== task.id));
      if (editing?.id === task.id) resetForm();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 border-t border-slate-200 pt-5">
      <h3 className="font-medium">{t("projects.tasks")}</h3>
      <Notice error={error} />
      <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_8rem_auto]">
        <Field label={editing ? t("projects.editTask") : t("projects.newTask")}>
          <input
            maxLength={200}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("projects.nextStep")}
          />
        </Field>
        <Field label={t("projects.taskStatus")}>
          <select
            disabled={busy}
            value={status}
            onChange={(event) => setStatus(event.target.value as TaskStatus)}
          >
            {Object.entries(statuses(t)).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {editing ? t("projects.saveTask") : t("projects.addTask")}
        </Button>
      </div>
      {editing && (
        <Button className="justify-self-start" disabled={busy} onClick={() => void edit(null)}>
          取消编辑
        </Button>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {Object.entries(statuses(t)).map(([key, label]) => {
          const column = tasks.filter((t) => t.status === key);
          return (
            <section key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h4 className="mb-3 flex items-center justify-between text-sm font-medium">
                {label}
                <span className="text-slate-500 tabular-nums">{column.length}</span>
              </h4>
              {column.map((task) => (
                <div key={task.id} className="mb-2 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="break-words text-sm leading-6">{task.title}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      className="px-2 py-1"
                      aria-label={`编辑任务 ${task.title}`}
                      disabled={busy}
                      onClick={() => void edit(task)}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      className="px-2 py-1"
                      aria-label={`删除任务 ${task.title}`}
                      disabled={busy}
                      onClick={() => void remove(task)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
              {!column.length && (
                <p className="py-6 text-center text-xs text-slate-500">{t("projects.noTask")}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

interface Draft {
  /** 提交时带上，服务端据此识别重复提交 */
  requestId: string;
  items: { title: string; selected: boolean }[];
}

export function Projects({ onDirty, onBusy, initialId }: ModuleProps) {
  const { t } = useI18n();
  // 任务看板在切换项目或批量加入后需要重新读取，改 key 让它重新挂载
  const [boardKey, setBoardKey] = useState(0);
  const [entryDirty, setEntryDirty] = useState(false);
  const [taskDirty, setTaskDirty] = useState(false);
  const [aiBusy, runAi] = useBusy(onBusy);
  const [joinBusy, runJoin] = useBusy(onBusy);
  const [draft, setDraft] = useState<Draft | null>(null);
  const confirm = useConfirm();
  const e = useEditor("projects", { description: "" }, setEntryDirty, initialId);
  const busy = aiBusy || joinBusy;

  useEffect(() => onDirty(entryDirty || taskDirty), [entryDirty, taskDirty, onDirty]);

  const currentId = e.current?.id;
  useEffect(() => setDraft(null), [currentId]);

  function refreshBoard() {
    setBoardKey((v) => v + 1);
    setTaskDirty(false);
  }

  async function generate() {
    if (busy) return;
    if (!e.current) return e.setError(t("projects.needProjectFirst"));
    const description = e.data.description || "";
    if (!description.trim()) return e.setError(t("projects.needDesc"));
    if (description.trim().length > AI_INPUT_LIMIT)
      return e.setError(t("projects.tooLong"));
    if (draft && !(await confirm(t("projects.regenConfirm")))) return;

    e.setError("");
    e.setSuccess("");
    await runAi(async () => {
      try {
        const result = await api<ProjectResult>("/ai/projects", "POST", {
          title: e.title,
          description,
        });
        setDraft({
          requestId: crypto.randomUUID(),
          items: result.tasks.map((t) => ({ title: t.title, selected: true })),
        });
        e.setSuccess(t("projects.draftReady"));
      } catch (err) {
        e.setError(message(err));
      }
    });
  }

  async function addSelected() {
    const project = e.current;
    if (!project || !draft || busy) return;
    const titles = draft.items
      .filter((item) => item.selected)
      .map((item) => item.title.trim())
      .filter(Boolean);
    if (!titles.length) return e.setError(t("projects.needPicked"));
    // 加入后看板会刷新，先让用户处理手上正在编辑的任务，免得内容丢失
    if (taskDirty) return e.setError(t("projects.needTaskSaved"));

    e.setError("");
    e.setSuccess("");
    await runJoin(async () => {
      try {
        const result = await api<{ tasks: Task[] }>(`/projects/${project.id}/tasks/batch`, "POST", {
          requestId: draft.requestId,
          tasks: titles.map((title) => ({ title })),
        });
        setDraft(null);
        refreshBoard();
        e.setSuccess(`已加入 ${result.tasks.length} 条任务。`);
      } catch (err) {
        const text = message(err);
        e.setError(text);
        // 批次冲突（比如这批任务已被回溯撤销）时草稿不能再提交，需要重新生成
        if (text.includes(t("projects.batch"))) setDraft(null);
      }
    });
  }

  function updateItem(index: number, patch: Partial<Draft["items"][number]>) {
    if (!draft) return;
    setDraft({
      ...draft,
      items: draft.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    });
  }

  // 切换项目前，除了项目本身，还要确认看板里有没有没保存的任务
  const editor = {
    ...e,
    select: async (item: Parameters<typeof e.select>[0]) => {
      if (taskDirty && !(await confirm(t("projects.taskSwitchConfirm")))) return false;
      if (!(await e.select(item))) return false;
      refreshBoard();
      return true;
    },
  };

  const selectedCount = draft?.items.filter((i) => i.selected).length ?? 0;

  return (
    <Workspace editor={editor} label={t("module.projects")} busy={busy}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={busy || e.saving} onClick={() => void generate()}>
          <Sparkles size={16} />
          {aiBusy ? t("projects.generating") : t("projects.generate")}
        </Button>
        <span className="text-xs text-slate-500">
          根据项目说明拆解任务草稿，勾选确认后才加入任务列表。
        </span>
      </div>

      {draft && (
        <div className="grid gap-4 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("projects.draftTitle")}</h3>
            <span className="text-xs text-slate-500">{t("projects.draftEditable")}</span>
          </div>
          <div className="grid gap-2">
            {draft.items.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  aria-label={`选择草稿 ${index + 1}`}
                  checked={item.selected}
                  disabled={joinBusy}
                  onChange={(event) => updateItem(index, { selected: event.target.checked })}
                />
                <input
                  className="w-full"
                  maxLength={200}
                  aria-label={`草稿任务 ${index + 1}`}
                  value={item.title}
                  disabled={joinBusy}
                  onChange={(event) => updateItem(index, { title: event.target.value })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void addSelected()}>
              {joinBusy ? t("projects.adding") : `确认加入所选（${selectedCount}）`}
            </Button>
            <Button disabled={busy} onClick={() => setDraft(null)}>
              放弃草稿
            </Button>
          </div>
        </div>
      )}

      <Field label={t("projects.desc")} hint={t("projects.limitHint")}>
        <textarea
          rows={3}
          maxLength={50000}
          disabled={aiBusy}
          value={e.data.description || ""}
          onChange={(event) => e.patch("description", event.target.value)}
          placeholder={t("projects.goalPlaceholder")}
        />
      </Field>

      {e.current ? (
        <fieldset disabled={busy} className="min-w-0">
          <TaskBoard
            key={`${e.current.id}-${boardKey}`}
            projectId={e.current.id}
            onDirty={setTaskDirty}
          />
        </fieldset>
      ) : (
        <Empty text={t("projects.needProject")} />
      )}
    </Workspace>
  );
}
