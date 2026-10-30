/**
 * 演示模式（npm run build:preview）下的前端模拟接口。
 * 没有后端和数据库，数据存在访客自己浏览器的 localStorage 里，互不影响；
 * AI 相关接口一律返回提示，不伪造生成结果。
 * 支持多账号：每个账号各自一份数据，账号列表与密码（仅演示，明文）也存本地。
 */

import { makeLog, reverse, type AuditLog } from "../../shared/audit";
import { searchKnowledge } from "../../shared/knowledge";
import { ACCOUNT } from "../../shared/constants";
import type { Entry, Kind, KindDataMap, Profile, Task } from "../../shared/types";

const dataKey = "ai-office-preview-v2";
const accountsKey = "ai-office-preview-accounts-v2";
const sessionKey = "ai-office-preview-session-v2";

interface PreviewBatch {
  requestId: string;
  projectId: string;
  titles: string[];
  taskIds: string[];
}

interface AccountRecord {
  username: string;
  password: string; // 演示模式明文，仅本浏览器
  profile: Profile;
}

const at = "2026-09-17T00:00:00.000Z";

const make = <K extends Kind>(id: string, kind: K, title: string, data: KindDataMap[K]): Entry =>
  ({
    id,
    kind,
    title,
    data,
    createdAt: at,
    updatedAt: at,
  }) as Entry;

const defaultProfile = (username: string, name: string): Profile => ({
  username,
  name,
  email: "",
  role: "",
  bio: "",
});

// 示例数据模板
const initial = {
  history: [] as AuditLog[],
  entries: [
    make("demo-writing", "writing", "示例 · 项目进度邮件", {
      mode: "compose",
      input: "向团队说明本周进度，并列出下周安排。",
      output:
        "【示例文稿，非 AI 实时生成】\n\n大家好：\n\n本周已完成需求梳理和原型设计，页面框架已经可以访问。\n\n下周计划完成数据接口联调，并安排一次内部试用，收集大家的使用意见。\n\n如有问题请随时沟通，谢谢。",
    }),
    make("demo-meeting", "meetings", "示例 · 周例会", {
      date: "2026-09-17",
      source: "讨论本周进度、遇到的问题以及下周分工。",
      summary: "原型设计已完成，下周重点是接口联调；测试环境由后端同学负责准备。",
      todos: "完成接口联调\n准备测试环境\n整理试用反馈表",
    }),
    make("demo-project", "projects", "示例 · 办公助手开发", {
      description: "这是示例项目，可以尝试添加任务或调整任务状态。修改只保存在当前浏览器。",
    }),
    make("demo-knowledge", "knowledge", "示例 · 项目交付流程", {
      keywords: "交付 验收 项目",
      source:
        "项目交付流程：先完成页面和功能自测，再准备演示环境，收集使用反馈并修改，最后整理文档并确认验收。",
    }),
    make("demo-document", "documents", "示例 · 功能说明", {
      source:
        "# AI 办公助手\n\n包含写作、会议纪要、项目管理、文档分析和知识库等模块。\n\n数据保存在本机，AI 功能通过用户自己配置的模型服务调用。",
      notes: "示例笔记：先看整体结构，再逐个模块体验。",
    }),
  ],
  tasks: [
    { id: "demo-task-1", projectId: "demo-project", title: "示例：完成原型设计", status: "done" },
    { id: "demo-task-2", projectId: "demo-project", title: "示例：接口联调", status: "doing" },
    { id: "demo-task-3", projectId: "demo-project", title: "示例：内部试用", status: "todo" },
  ] as Task[],
  batches: [] as PreviewBatch[],
};

// 演示数据，标题统一以「示例」开头
const makeInitial = (username: string): typeof initial => {
  const base = structuredClone(initial);
  // 每个账号的示例数据用唯一的 id，避免多账号间冲突
  const prefix = username.replace(/[^a-zA-Z0-9]/g, "");
  base.entries = base.entries.map((e) => ({ ...e, id: `${prefix}-${e.id}` }));
  base.tasks = base.tasks.map((t) => ({
    ...t,
    id: `${prefix}-${t.id}`,
    projectId: `${prefix}-${t.projectId}`,
  }));
  return base;
};

export function createPreviewApi(storage: Pick<Storage, "getItem" | "setItem">) {
  function readAccounts(): AccountRecord[] {
    try {
      const raw = storage.getItem(accountsKey);
      const value = raw ? JSON.parse(raw) : [];
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeAccounts(accounts: AccountRecord[]) {
    storage.setItem(accountsKey, JSON.stringify(accounts));
  }

  function listProfiles(): Profile[] {
    return readAccounts().map((a) => a.profile);
  }

  function currentUsername(): string | null {
    return storage.getItem(sessionKey) || null;
  }

  function currentProfile(): Profile | null {
    const username = currentUsername();
    if (!username) return null;
    const account = readAccounts().find((a) => a.username === username);
    return account ? account.profile : null;
  }

  // 读取当前账号的数据
  function read(): typeof initial {
    const username = currentUsername();
    if (!username) return structuredClone(initial);
    const raw = storage.getItem(`${dataKey}:${username}`);
    if (raw) {
      try {
        const value = JSON.parse(raw);
        if (Array.isArray(value.entries) && Array.isArray(value.tasks))
          return {
            ...value,
            history: value.history || [],
            batches: value.batches || [],
          };
      } catch {
        // 数据损坏时恢复成示例数据
      }
    }
    return makeInitial(username);
  }

  function write(data: typeof initial) {
    const username = currentUsername();
    if (!username) return;
    try {
      storage.setItem(`${dataKey}:${username}`, JSON.stringify(data));
    } catch {
      throw Error("浏览器存储空间不足或被禁用，未能保存；当前输入仍保留。");
    }
  }

  return async function previewApi<T>(path: string, method = "GET", body?: any): Promise<T> {
    if (path === "/auth/session")
      return {
        accounts: listProfiles(),
        user: currentProfile(),
      } as T;

    if (path === "/auth/setup") {
      const username = String(body?.username || "").trim();
      const password = String(body?.password || "");
      const name = String(body?.name || username).trim() || username;
      if (!username || username.length < ACCOUNT.usernameMin) throw Error(`账号至少 ${ACCOUNT.usernameMin} 位。`);
      if (password.length < ACCOUNT.passwordMin) throw Error(`密码至少 ${ACCOUNT.passwordMin} 位。`);
      const accounts = readAccounts();
      if (accounts.some((a) => a.username === username)) throw Error("该账号名已被使用，请换一个。");
      const record: AccountRecord = {
        username,
        password,
        profile: defaultProfile(username, name),
      };
      accounts.push(record);
      writeAccounts(accounts);
      storage.setItem(sessionKey, username);
      return { accounts: listProfiles(), user: record.profile } as T;
    }

    if (path === "/auth/login") {
      const username = String(body?.username || "").trim();
      const password = String(body?.password || "");
      const account = readAccounts().find((a) => a.username === username);
      if (!account || account.password !== password) throw Error("账号或密码不正确。");
      storage.setItem(sessionKey, username);
      return { accounts: listProfiles(), user: account.profile } as T;
    }

    if (path === "/auth/logout") {
      storage.setItem(sessionKey, "");
      return { ok: true } as T;
    }

    if (path === "/profile") {
      const username = currentUsername();
      if (!username) throw Error("请先登录。");
      const accounts = readAccounts();
      const account = accounts.find((a) => a.username === username);
      if (!account) throw Error("账号不存在。");
      if (method === "PUT") {
        account.profile = {
          username,
          name: String(body.name || "演示用户").slice(0, 60),
          email: String(body.email || "").slice(0, 120),
          role: String(body.role || "").slice(0, 80),
          bio: String(body.bio || "").slice(0, 500),
        };
        writeAccounts(accounts);
        return account.profile as T;
      }
      return account.profile as T;
    }

    if (path.startsWith("/knowledge/search"))
      return searchKnowledge(
        read().entries,
        new URL(path, "https://preview.local").searchParams.get("q") || "",
      ) as T;

    if (path.startsWith("/ai/"))
      throw Error("演示模式不提供 AI 调用，请在本机完整版中配置模型后使用。");

    // 资源库的文件上传 / 下载 / 预览 / AI 分析均依赖后端文件存储，演示模式不支持
    if (path.startsWith("/resources/"))
      throw Error("演示模式不支持文件上传与预览，请在本机完整版中使用。");

    if (path.startsWith("/settings")) {
      if (method !== "GET") throw Error("演示模式不接收或保存 API Key。");
      return { baseUrl: "", model: "", hasKey: false } as T;
    }

    // 以下接口会读写本地数据
    const data = read();
    const before = structuredClone(data);
    const save = () => {
      const log = makeLog(
        before,
        data,
        method === "DELETE" ? "删除" : method === "PUT" ? "修改" : "新增",
      );
      if (log) data.history.unshift(log);
      write(data);
    };

    if (path === "/history") return data.history as T;

    if (/^\/history\/[^/]+\/restore$/.test(path) && method === "POST") {
      const log = data.history.find((l) => l.id === path.split("/")[2]);
      if (!log) throw Error("日志不存在。");
      const next = reverse(data, log);
      const undo = makeLog(data, next, "回溯");
      log.revertedBy = undo?.id || "restored";
      write({
        ...next,
        history: undo ? [undo, ...data.history] : data.history,
        batches: data.batches,
      });
      return { ok: true } as T;
    }

    // 记录与任务的增删改，路径格式与后端 REST 接口一致
    const url = new URL(path, "https://preview.local");
    const parts = url.pathname.split("/").filter(Boolean);
    let result: unknown;
    if (parts[0] === "entries") {
      if (method === "GET") {
        const kind = url.searchParams.get("kind");
        result = parts[1]
          ? data.entries.find((e) => e.id === parts[1])
          : data.entries
              .filter((e) => !kind || e.kind === kind)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      } else if (method === "POST" || method === "PUT") {
        if (!body?.title?.trim()) throw Error("请填写标题。");
        const existing = method === "PUT" ? data.entries.find((e) => e.id === parts[1]) : undefined;
        if (method === "PUT" && !existing) throw Error("记录已删除，请重新打开。");
        if (
          method === "POST" &&
          !["writing", "meetings", "projects", "documents", "knowledge", "resources"].includes(
            parts[1],
          )
        )
          throw Error("未知模块。");
        const now = new Date().toISOString();
        const entry: Entry = {
          id: existing?.id || crypto.randomUUID(),
          kind: existing?.kind || (parts[1] as Kind),
          title: body.title.trim(),
          data: structuredClone(body.data),
          createdAt: existing?.createdAt || now,
          updatedAt: now,
        };
        data.entries = data.entries.filter((e) => e.id !== entry.id);
        data.entries.push(entry);
        save();
        result = entry;
      } else if (method === "DELETE") {
        data.entries = data.entries.filter((e) => e.id !== parts[1]);
        data.tasks = data.tasks.filter((t) => t.projectId !== parts[1]);
        save();
        result = { ok: true };
      }
    } else if (parts[0] === "projects" && parts[2] === "tasks") {
      const projectId = parts[1];
      if (!data.entries.some((e) => e.id === projectId && e.kind === "projects"))
        throw Error("项目不存在。");
      if (parts[3] === "batch" && method === "POST") {
        const requestId = String(body?.requestId || "").trim();
        const titles = Array.isArray(body?.tasks)
          ? body.tasks.map((t: any) => String(t?.title || "").trim())
          : [];
        if (
          !requestId ||
          !titles.length ||
          titles.length > 20 ||
          titles.some((t: string) => !t || t.length > 200)
        )
          throw Error("请检查任务批次内容。");
        const seen = data.batches.find((b) => b.requestId === requestId);
        if (seen) {
          if (
            seen.projectId !== projectId ||
            JSON.stringify(seen.titles) !== JSON.stringify(titles)
          )
            throw Error("该批次编号已被其他内容使用，请重新生成任务草稿。");
          const tasks = seen.taskIds
            .map((id) => data.tasks.find((t) => t.id === id))
            .filter((t): t is Task => !!t);
          if (tasks.length !== seen.taskIds.length)
            throw Error("该批次已回溯撤销，请重新生成任务草稿再加入。");
          result = { tasks, replayed: true };
        } else {
          const tasks: Task[] = titles.map((title: string) => ({
            id: crypto.randomUUID(),
            projectId,
            title,
            status: "todo",
          }));
          data.tasks.push(...tasks);
          data.entries.find((e) => e.id === projectId)!.updatedAt = new Date().toISOString();
          data.batches.push({
            requestId,
            projectId,
            titles,
            taskIds: tasks.map((t) => t.id),
          });
          save();
          result = { tasks, replayed: false };
        }
      } else if (method === "GET") result = data.tasks.filter((t) => t.projectId === projectId);
      else if (method === "POST" || method === "PUT") {
        if (!body?.title?.trim() || !["todo", "doing", "done"].includes(body.status))
          throw Error("请检查任务名称与状态。");
        const existing =
          method === "PUT"
            ? data.tasks.find((t) => t.id === parts[3] && t.projectId === projectId)
            : undefined;
        if (method === "PUT" && !existing) throw Error("任务不存在。");
        const task: Task = {
          id: existing?.id || crypto.randomUUID(),
          projectId,
          title: body.title.trim(),
          status: body.status,
        };
        data.tasks = data.tasks.filter((t) => t.id !== task.id);
        data.tasks.push(task);
        data.entries.find((e) => e.id === projectId)!.updatedAt = new Date().toISOString();
        save();
        result = task;
      } else if (method === "DELETE") {
        data.tasks = data.tasks.filter((t) => !(t.projectId === projectId && t.id === parts[3]));
        save();
        result = { ok: true };
      }
    }

    if (result === undefined) throw Error("演示记录或操作不存在。");
    return structuredClone(result) as T;
  };
}

let preview: ReturnType<typeof createPreviewApi> | undefined;

export function previewApi<T>(path: string, method: string, body?: unknown) {
  preview ??= createPreviewApi(localStorage);
  return preview<T>(path, method, body);
}
