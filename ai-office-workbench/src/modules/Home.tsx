import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowRight, BookOpen, Clock3, Plus } from "lucide-react";
import type { Entry, Profile, Settings } from "../../shared/types";
import { LightFrame } from "../components/LightFrame";
import { SceneCarousel } from "../components/SceneCarousel";
import { Button, Empty, Notice } from "../components/ui";
import { navigation, type Page } from "../config";
import { api, message } from "../lib/api";
import { isPreview } from "../lib/runtime";
import { LiveTime } from "./Clock";

const descriptions = {
  writing: "把灵感变成清晰的表达。",
  meetings: "让每一次讨论都有迹可循。",
  projects: "拆解目标，有序推进。",
  documents: "从信息中整理出思路。",
};

export function Home({
  navigate,
  user,
}: {
  navigate: (page: Page, id?: string) => void;
  user: Profile;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api<Entry[]>("/entries"), api<Settings>("/settings")])
      .then(([rows, s]) => {
        setEntries(rows);
        setSettings(s);
      })
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="home-grid">
      <Notice error={error} />
      <section className="workspace-hero light-frame-host">
        <LightFrame />
        <SceneCarousel />
        <div className="hero-copy">
          <span className="hero-tag">
            <span className="status-dot" />
            YOUR INTELLIGENCE, CONNECTED
          </span>
          <h2>
            让知识有序。
            <br />
            让想法发生。
          </h2>
          <p>
            {user.name}，欢迎回到你的工作空间。
            <br />
            连接写作、知识与行动，专注真正重要的事。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => navigate("writing")}>
              开始写作
              <ArrowRight size={16} />
            </Button>
            <Button onClick={() => navigate("knowledge")}>打开知识库</Button>
          </div>
        </div>
      </section>
      <div className="section-label">
        <h2>效率工具</h2>
        <span>MAKE ROOM FOR YOUR IDEAS</span>
      </div>
      <div className="tool-grid">
        {navigation
          .filter((n) => ["writing", "meetings", "projects", "documents"].includes(n.id))
          .map((n, i) => (
            <button
              key={n.id}
              onClick={() => navigate(n.id)}
              className="tool-card light-frame-host"
            >
              <LightFrame delay={i * 1.8} />
              <div className="tool-card-top">
                <span className="tool-icon">
                  <n.icon size={23} />
                </span>
                <span className="eyebrow">0{i + 1}</span>
              </div>
              <h3>{n.title}</h3>
              <p>{descriptions[n.id as keyof typeof descriptions]}</p>
              <div className="tool-card-bottom">
                <span>{n.id === "writing" ? "撰写 / 润色 / 摘要" : "整理 / 编辑 / 保存"}</span>
                <ArrowUpRight size={17} />
              </div>
            </button>
          ))}
      </div>
      <div className="home-lower">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <h2>最近的工作</h2>
            <span>{loading ? "正在读取" : `${entries.length} 条已保存记录`}</span>
          </div>
          {loading ? (
            <p className="p-6 text-sm text-slate-500">正在读取记录…</p>
          ) : entries.length ? (
            <div>
              {entries.slice(0, 5).map((item) => {
                const Icon = navigation.find((n) => n.id === item.kind)?.icon || BookOpen;
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(item.kind, item.id)}
                    className="recent-row"
                  >
                    <span className="recent-icon">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong>{item.title}</strong>
                      <small>{navigation.find((n) => n.id === item.kind)?.title}</small>
                    </span>
                    <time>
                      {new Date(item.updatedAt).toLocaleDateString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                      })}
                    </time>
                    <ArrowUpRight size={15} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-5">
              <Empty
                text="这里还没有记录，先保存你的第一份文稿。"
                action={
                  <Button onClick={() => navigate("writing")}>
                    <Plus size={16} />
                    新建写作
                  </Button>
                }
              />
            </div>
          )}
        </section>
        <aside className="home-side">
          <button className="panel knowledge-shortcut" onClick={() => navigate("knowledge")}>
            <div className="flex items-center justify-between">
              <BookOpen size={23} />
              <ArrowUpRight size={18} />
            </div>
            <h3>你的知识，随时调用。</h3>
            <p>
              记录资料、添加关键词，
              <br />
              下一次查找从这里开始。
            </p>
            <span className="eyebrow">PERSONAL KNOWLEDGE BASE</span>
          </button>
          <div className="panel mini-clock">
            <div className="flex items-center justify-between">
              <span className="eyebrow">FOCUS TIME</span>
              <Clock3 size={18} />
            </div>
            <LiveTime />
            <Button onClick={() => navigate("clock")}>
              开始一段专注
              <ArrowRight size={15} />
            </Button>
          </div>
        </aside>
      </div>
      <div className="workspace-footer">
        <span>
          <span className="status-dot" />
          {isPreview
            ? "演示模式 · 数据保存在当前浏览器"
            : settings?.hasKey
              ? "已配置 AI 密钥 · 可在设置中测试"
              : "AI 尚未配置 · 添加密钥后可使用"}
        </span>
        <button onClick={() => navigate("settings")}>
          连接设置 <ArrowUpRight size={13} />
        </button>
      </div>
    </div>
  );
}
