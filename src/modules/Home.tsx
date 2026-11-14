import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowRight, BookOpen, Clock3, Plus } from "lucide-react";
import type { Entry, Profile, Settings } from "../../shared/types";
import { LightFrame } from "../components/LightFrame";
import { SceneCarousel } from "../components/SceneCarousel";
import { Button, Empty, Notice } from "../components/ui";
import { navigation, navTitleKey, type Page } from "../config";
import { api, message } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { isPreview } from "../lib/runtime";
import { LiveTime } from "./Clock";

export function Home({
  navigate,
  user,
}: {
  navigate: (page: Page, id?: string) => void;
  user: Profile;
}) {
  const { t, locale } = useI18n();
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

  /** 记录所属模块的名字，找不到对应导航时退回 kind 本身 */
  function kindTitle(kind: string) {
    const hit = navigation.find((n) => n.id === kind);
    return hit ? t(navTitleKey(hit.id)) : kind;
  }

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
            {t("home.hero.title1")}
            <br />
            {t("home.hero.title2")}
          </h2>
          <p>
            {t("home.hero.lead", { name: user.name })}
            <br />
            {t("home.hero.lead2")}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => navigate("writing")}>
              {t("home.hero.ctaPrimary")}
              <ArrowRight size={16} />
            </Button>
            <Button onClick={() => navigate("knowledge")}>{t("home.hero.ctaSecondary")}</Button>
          </div>
        </div>
      </section>
      <div className="section-label">
        <h2>{t("home.tools.heading")}</h2>
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
              <h3>{t(navTitleKey(n.id))}</h3>
              <p>{t(`home.tools.${n.id}` as "home.tools.writing")}</p>
              <div className="tool-card-bottom">
                <span>
                  {n.id === "writing" ? t("home.tools.metaWriting") : t("home.tools.metaDefault")}
                </span>
                <ArrowUpRight size={17} />
              </div>
            </button>
          ))}
      </div>
      <div className="home-lower">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <h2>{t("home.recent.heading")}</h2>
            <span>
              {loading
                ? t("home.recent.loading")
                : t("home.recent.count", { n: entries.length })}
            </span>
          </div>
          {loading ? (
            <p className="p-6 text-sm text-slate-500">{t("home.recent.loading")}…</p>
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
                      <small>{kindTitle(item.kind)}</small>
                    </span>
                    <time>
                      {new Date(item.updatedAt).toLocaleDateString(locale, {
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
                text={t("home.recent.empty")}
                action={
                  <Button onClick={() => navigate("writing")}>
                    <Plus size={16} />
                    {t("home.recent.newDraft")}
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
            <h3>{t("home.knowledge.title")}</h3>
            <p>
              {t("home.knowledge.body1")}
              <br />
              {t("home.knowledge.body2")}
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
              {t("home.clock.cta")}
              <ArrowRight size={15} />
            </Button>
          </div>
        </aside>
      </div>
      <div className="workspace-footer">
        <span>
          <span className="status-dot" />
          {isPreview
            ? t("home.footer.demo")
            : settings?.hasKey
              ? t("home.footer.ready")
              : t("home.footer.noKey")}
        </span>
        <button onClick={() => navigate("settings")}>
          {t("home.footer.cta")} <ArrowUpRight size={13} />
        </button>
      </div>
    </div>
  );
}
