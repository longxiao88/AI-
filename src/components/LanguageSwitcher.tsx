import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Languages, Plus } from "lucide-react";
import { coverageOf, useI18n } from "../lib/i18n";
import { LocaleImportDialog } from "./LocaleImportDialog";

/**
 * 顶栏的语言切换器：一个按钮展开语言列表。
 *
 * 为什么不是二元开关 —— 主题只有两个值，点了就翻过去；语言会随导入变多，
 * 循环点击既不知道当前在哪、也看不到每份语言包翻了多少。
 *
 * 当前项用中性灰底标记，不用品牌强调色：强调色在这套界面里只留给数据。
 */
export function LanguageSwitcher() {
  const { locale, localeName, packs, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="lang-switcher" ref={rootRef}>
      <button
        type="button"
        className="lang-toggle"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t("lang.label")}: ${localeName}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Languages size={15} aria-hidden="true" />
        <span>{localeName}</span>
        <ChevronDown size={13} className="lang-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="lang-menu" role="listbox" aria-label={t("lang.label")}>
          <div className="lang-menu-label">{t("lang.label")}</div>
          {packs.map((pack) => {
            const percent = coverageOf(pack);
            const active = pack.code === locale;
            return (
              <button
                key={pack.code}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? "lang-option is-active" : "lang-option"}
                onClick={() => {
                  setLocale(pack.code);
                  setOpen(false);
                }}
              >
                <span className="lang-option-name">{pack.name}</span>
                {/* 完整翻译不打扰：只有缺条目时才标出覆盖率 */}
                {percent < 100 && (
                  <span className="lang-option-pct" data-low="">
                    {t("lang.coverage", { n: percent })}
                  </span>
                )}
                {active && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
          <div className="lang-menu-sep" />
          <button
            type="button"
            className="lang-import"
            onClick={() => {
              setOpen(false);
              setImportOpen(true);
            }}
          >
            <Plus size={12} aria-hidden="true" />
            {t("lang.import")}
          </button>
        </div>
      )}

      {importOpen && <LocaleImportDialog onClose={() => setImportOpen(false)} />}
    </div>
  );
}
