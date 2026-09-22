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
} from "lucide-react";

export const appName = "AI 办公助手";

export const navigation = [
  {
    id: "home",
    title: "工作台",
    icon: LayoutDashboard,
    description: "从一件小事开始，让工作更有条理。",
  },
  {
    id: "chat",
    title: "AI 问答",
    icon: MessageSquare,
    description: "直接提问，接着追问，让思路更清楚。",
  },
  {
    id: "writing",
    title: "AI 写作",
    icon: PenLine,
    description: "从想法到表达，让文字更进一步。",
  },
  {
    id: "meetings",
    title: "会议纪要",
    icon: NotebookPen,
    description: "留下讨论重点，让每一项行动都有据可循。",
  },
  {
    id: "projects",
    title: "项目管理",
    icon: KanbanSquare,
    description: "拆解工作，专注下一步。",
  },
  {
    id: "documents",
    title: "文档分析",
    icon: FileText,
    description: "整理原文，沉淀自己的理解。",
  },
  {
    id: "knowledge",
    title: "知识库",
    icon: BookOpen,
    description: "积累你的资料，让每一次查找都有依据。",
  },
  {
    id: "clock",
    title: "时钟与计时",
    icon: Timer,
    description: "看见时间，把注意力留给当下。",
  },
  {
    id: "history",
    title: "操作日志",
    icon: History,
    description: "查看每次变更，让操作可以追溯。",
  },
  {
    id: "profile",
    title: "个人资料",
    icon: UserRound,
    description: "让这个工作空间更了解你。",
  },
  {
    id: "settings",
    title: "设置",
    icon: Settings2,
    description: "连接你自己的 AI 服务。",
  },
] as const;

export type Page = (typeof navigation)[number]["id"];

export const modeNames = { compose: "撰写", polish: "润色", summary: "摘要" };
