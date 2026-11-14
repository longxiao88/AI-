export type Kind = "writing" | "meetings" | "projects" | "documents" | "knowledge" | "resources";

export type Mode = "compose" | "polish" | "summary";

export type TaskStatus = "todo" | "doing" | "done";

/**
 * 各模块的内容字段存在 entries.data 这个 JSON 里。
 * 按模块拆成独立类型，再由 KindDataMap 建立 kind → data 的映射，
 * Entry 据此成为判别联合：kind 为 "writing" 时 data 一定是 WritingData。
 */

/** 写作 */
export interface WritingData {
  mode?: Mode;
  input?: string;
  output?: string;
}

/** 会议纪要 */
export interface MeetingData {
  date?: string;
  source?: string;
  summary?: string;
  todos?: string;
}

/** 项目管理 */
export interface ProjectData {
  description?: string;
}

/** 文档分析 */
export interface DocumentData {
  source?: string;
  notes?: string;
}

/** 知识库 */
export interface KnowledgeData {
  source?: string;
  keywords?: string;
}

/** 资源库：只存文件元信息，文件本体在服务器的 data/files/ */
export interface ResourceData {
  filename?: string;
  ext?: string;
  size?: number;
  category?: string;
  downloads?: number;
  /** 磁盘上的唯一存储文件名（由后端生成，前端只读） */
  storedName?: string;
  notes?: string;
}

/** kind 与它对应的 data 结构 */
export interface KindDataMap {
  writing: WritingData;
  meetings: MeetingData;
  projects: ProjectData;
  documents: DocumentData;
  knowledge: KnowledgeData;
  resources: ResourceData;
}

/** 所有模块 data 的联合，仅用于「不关心具体模块」的场景（如编辑器的内部状态） */
export type ContentData = KindDataMap[Kind];

interface EntryBase {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 记录：按 kind 判别的联合类型。
 * 访问 `entry.data` 之前先判断 `entry.kind`，TypeScript 会自动收窄到对应结构。
 */
export type Entry = {
  [K in Kind]: EntryBase & { kind: K; data: KindDataMap[K] };
}[Kind];

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
  /** 所属账号（前端一般用不到，仅后端内部使用） */
  accountId?: string;
}

export interface Settings {
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface Profile {
  username: string;
  name: string;
  email: string;
  /** 邮箱是否已通过验证（用于找回密码） */
  emailVerified?: boolean;
  role: string;
  bio: string;
}

export interface AuthState {
  /** 本工作空间已注册的账号列表（仅含用户名与显示名，不含密码信息） */
  accounts: Profile[];
  user: Profile | null;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  excerpt: string;
  score: number;
}
