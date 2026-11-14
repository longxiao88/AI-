import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import { api } from "../lib/api";
import { buildLocaleTemplate, useI18n } from "../lib/i18n";
import { Button } from "./ui";

/**
 * 语言包导入说明窗。
 *
 * 不做上传接口 —— 这是本机应用，把 json 丢进 data/locales/ 最直接：
 * 用户能随时用记事本改，也能把文件发给别人。这个窗只负责三件事：
 * 把目录告诉用户、帮他打开它、给一份带全部 key 的模板。
 */
export function LocaleImportDialog({ onClose }: { onClose: () => void }) {
  const { t, localeDir, reloadLocales, skipped, packs } = useI18n();
  const [copied, setCopied] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(localeDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setNote(localeDir);
    }
  }

  async function openFolder() {
    try {
      await api("/locales/reveal", "POST");
    } catch {
      setNote(localeDir);
    }
  }

  function downloadTemplate() {
    const blob = new Blob([buildLocaleTemplate()], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "locale-template.json";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function rescan() {
    setRescanning(true);
    await reloadLocales();
    setRescanning(false);
  }

  // 内置两种（中文、英文）不算「导入的」
  const imported = packs.filter((p) => p.code !== "zh-CN" && p.code !== "en");

  // 挂到 body：`.app-main` 带 perspective:1600px（页面翻转动画），
  // 它会让内部的 position:fixed 变成相对它自己定位，遮罩就只能盖住内容区
  return createPortal(
    <div
      className="lang-dialog-mask"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="lang-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("lang.import")}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="lang-dialog-head">
          <h2>{t("lang.import")}</h2>
          <button type="button" className="lang-dialog-x" aria-label={t("lang.close")} onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <p className="lang-dialog-lede">{t("lang.importHint")}</p>

        <div className="lang-dialog-field">
          <span className="lang-dialog-label">{t("lang.dirLabel")}</span>
          <code className="lang-dialog-path">{localeDir || "…"}</code>
        </div>

        <div className="lang-dialog-actions">
          <Button onClick={() => void openFolder()}>
            <FolderOpen size={14} />
            {t("lang.openDir")}
          </Button>
          <Button onClick={() => void copyPath()}>
            {copied ? t("lang.copied") : t("lang.copyPath")}
          </Button>
          <Button onClick={downloadTemplate}>{t("lang.downloadTemplate")}</Button>
        </div>

        <p className="lang-dialog-note">{t("lang.templateHint")}</p>

        {note && <code className="lang-dialog-path">{note}</code>}

        <div className="lang-dialog-foot">
          <span className="lang-dialog-stat">
            {t("lang.importedCount", { n: imported.length })}
            {imported.length > 0 && ` · ${imported.map((p) => p.name).join("、")}`}
          </span>
          <Button disabled={rescanning} onClick={() => void rescan()}>
            <RefreshCw size={14} />
            {t("lang.rescan")}
          </Button>
        </div>

        {skipped.length > 0 && (
          <div className="lang-dialog-skipped">
            <strong>{t("lang.skippedTitle", { n: skipped.length })}</strong>
            <ul>
              {skipped.map((item) => (
                <li key={item.file}>
                  {item.file} — {item.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
