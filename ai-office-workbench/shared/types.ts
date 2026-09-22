export type Kind = "writing" | "meetings" | "projects" | "documents" | "knowledge";

export type Mode = "compose" | "polish" | "summary";

export type TaskStatus = "todo" | "doing" | "done";

/** 各模块的内容字段都存在 entries.data 这个 JSON 里，按模块取用。 */
export interface ContentData {
  // 写作
  input?: string;
  output?: string;
  mode?: Mode;
  // 会议纪要
  date?: string;
  summary?: string;
  todos?: string;
  // 文档 / 知识库 / 会议原文
  source?: string;
  notes?: string;
  keywords?: string;
  // 项目
  description?: string;
}

export interface Entry {
  id: string;
  kind: Kind;
  title: string;
  data: ContentData;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: TaskStatus;
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
  role: string;
  bio: string;
}

export interface AuthState {
  setupRequired: boolean;
  user: Profile | null;
}

export interface KnowledgeHit {
  id: string;
  title: string;
  excerpt: string;
  score: number;
}
