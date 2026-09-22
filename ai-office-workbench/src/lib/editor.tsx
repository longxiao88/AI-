import { useEffect, useState } from "react";
import type { ContentData, Entry, Kind } from "../../shared/types";
import { useConfirm } from "../components/ui";
import { api, message } from "./api";
import { isPreview } from "./runtime";

/** 各业务页面共用的 props */
export interface ModuleProps {
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  initialId?: string;
}

/**
 * 通用的「列表 + 编辑表单」状态：读取列表、切换记录、保存、删除，
 * 并在内容有改动时通过 onDirty 通知外层，离开页面前会提示。
 */
export function useEditor(
  kind: Kind,
  defaults: ContentData,
  onDirty: (value: boolean) => void,
  initialId?: string,
) {
  const [items, setItems] = useState<Entry[]>([]);
  const [current, setCurrent] = useState<Entry | null>(null);
  const [title, setTitle] = useState("");
  const [data, setData] = useState<ContentData>(defaults);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const saved = current
    ? { title: current.title, data: current.data }
    : { title: "", data: defaults };
  const dirty = JSON.stringify({ title, data }) !== JSON.stringify(saved);

  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  useEffect(() => {
    let active = true;
    api<Entry[]>(`/entries?kind=${kind}`)
      .then((rows) => {
        if (!active) return;
        setItems(rows);
        const item = rows.find((row) => row.id === initialId);
        if (item) load(item);
      })
      .catch((e) => active && setError(message(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [kind, initialId]);

  function load(item: Entry | null) {
    setCurrent(item);
    setTitle(item?.title || "");
    setData(item?.data || defaults);
  }

  const patch = (key: keyof ContentData, value: string) =>
    setData((previous) => ({ ...previous, [key]: value }));

  async function select(item: Entry | null) {
    if (dirty && !(await confirm("当前内容尚未保存，确认放弃修改并切换吗？"))) return false;
    load(item);
    setError("");
    setSuccess("");
    return true;
  }

  async function save() {
    if (saving) return;
    setError("");
    setSuccess("");
    if (!title.trim()) {
      setError("请先填写标题。");
      return;
    }

    setSaving(true);
    try {
      const value = current
        ? await api<Entry>(`/entries/${current.id}`, "PUT", { title, data })
        : await api<Entry>(`/entries/${kind}`, "POST", { title, data });
      load(value);
      setItems(await api<Entry[]>(`/entries?kind=${kind}`));
      setSuccess(isPreview ? "已保存到当前浏览器（演示数据）。" : "已保存到本机。");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!current) return;
    const question =
      kind === "projects"
        ? "删除该项目会同时删除全部任务，且无法恢复。确认删除吗？"
        : "删除这条记录后无法恢复。确认删除吗？";
    if (!(await confirm(question))) return;

    setSaving(true);
    setError("");
    try {
      await api(`/entries/${current.id}`, "DELETE");
      setItems(items.filter((item) => item.id !== current.id));
      load(null);
      setSuccess("记录已删除。");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return {
    items,
    current,
    title,
    setTitle,
    data,
    patch,
    error,
    setError,
    success,
    setSuccess,
    loading,
    saving,
    select,
    save,
    remove,
  };
}

export type Editor = ReturnType<typeof useEditor>;
