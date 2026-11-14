import {
  MessageSquare,
  LayoutDashboard,
  PenLine,
  NotebookPen,
  KanbanSquare,
  FileText,
  Settings2,
  BookOpen,
  Timer,
  UserRound,
  History,
  Search,
  FolderOpen,
} from "lucide-react";
import type { MessageKey } from "./lib/i18n/zh-CN";

export const appName = "AIpharis Muse";

/**
 * 导航只留结构，文案全部交给 i18n 字典（nav.<id>.title / nav.<id>.desc）。
 * 这里不写任何中文 —— 写死一句就多一处翻译不到的地方。
 */
export const navigation = [
  { id: "home", icon: LayoutDashboard },
  { id: "search", icon: Search },
  { id: "chat", icon: MessageSquare },
  { id: "writing", icon: PenLine },
  { id: "meetings", icon: NotebookPen },
  { id: "projects", icon: KanbanSquare },
  { id: "documents", icon: FileText },
  { id: "knowledge", icon: BookOpen },
  { id: "resources", icon: FolderOpen },
  { id: "clock", icon: Timer },
  { id: "history", icon: History },
  { id: "profile", icon: UserRound },
  { id: "settings", icon: Settings2 },
] as const;

export type Page = (typeof navigation)[number]["id"];

/** 导航标题的字典 key，模板字面量类型正好落在 MessageKey 里，拼错会编译报错 */
export const navTitleKey = (id: Page) => `nav.${id}.title` as MessageKey;

export const modeKeys = {
  compose: "mode.compose",
  polish: "mode.polish",
  summary: "mode.summary",
} as const satisfies Record<string, MessageKey>;

export type ModeKey = keyof typeof modeKeys;
