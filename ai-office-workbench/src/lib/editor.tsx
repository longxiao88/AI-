import { useEffect, useMemo, useRef, useState } from "react";
import type { Entry, Kind, KindDataMap } from "../../shared/types";
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
 *
 * 泛型 K 绑定模块类型，因此 defaults 与 data 都是该模块专属结构，
 * 写错字段名会在编译期报错。
 */
export function useEditor<K extends Kind>(
  kind: K,
  defaults: KindDataMap[K],
  onDirty: (value: boolean) => void,
  initialId?: string,
) {
  const [items, setItems] = useState<Entry[]>([]);
  const [current, setCurrent] = useState<Entry | null>(null);
  const [title, setTitle] = useState("");
  const [data, setData] = useState<KindDataMap[K]>(defaults);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  // 各页面把 defaults 写成内联对象，每次渲染都是新引用。
  // 这里固定首次传入的那一份，避免脏检查的 useMemo 每次都失效。
  const initial = useRef(defaults).current;

  // 只在标题或正文真正变化时序列化；切换 loading、提示语等无关状态不会重复计算。
  const dirty = useMemo(() => {
    const saved = current
      ? { title: current.title, data: current.data }
      : { title: "", data: initial };
    return JSON.stringify({ title, data }) !== JSON.stringify(saved);
  }, [title, data, current, initial]);

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
    // 列表来自按 kind 过滤的接口，data 结构与 K 一致，这里的断言是安全的
    setData((item?.data as KindDataMap[K]) || initial);
  }

  const patch = (key: keyof KindDataMap[K] & string, value: string) =>
    setData((previous) => ({ ...previous, [key]: value }) as KindDataMap[K]);

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

type Editor<K extends Kind = Kind> = ReturnType<typeof useEditor<K>>;

/** Workspace 骨架只需要这些与模块类型无关的字段（不碰 data / patch） */
export type WorkspaceEditor = Pick<
  Editor<Kind>,
  | "items"
  | "current"
  | "title"
  | "setTitle"
  | "loading"
  | "saving"
  | "select"
  | "save"
  | "remove"
  | "error"
  | "success"
>;
