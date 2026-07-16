import { useEffect, useState } from "react";
import type { UpdateBridge, UpdateSettings, UpdateState } from "../../types/update";

interface UpdateSettingsModalProps {
  bridge: UpdateBridge;
  isOpen: boolean;
  settings: UpdateSettings;
  state: UpdateState | null;
  onClose(): void;
  onSettingsChanged(settings: UpdateSettings): void;
  onStateChanged(state: UpdateState): void;
}

const policyOptions: Array<{ value: UpdateSettings["updatePolicy"]; title: string; description: string }> = [
  { value: "automatic", title: "自动更新", description: "启动后自动检测并下载，完成后由你选择安装时间。" },
  { value: "manual", title: "手动更新", description: "启动时不联网，只在点击“检查更新”后检测和下载。" },
  { value: "disabled", title: "禁止更新", description: "不检测、不下载，也不显示更新提示。" }
];

const networkOptions: Array<{ value: UpdateSettings["updateNetworkMode"]; title: string; description: string }> = [
  { value: "automaticProxy", title: "自动检测代理", description: "优先环境变量和本机常用代理端口，未找到时直连。" },
  { value: "manualProxy", title: "手动代理", description: "只使用下方填写并验证通过的代理地址。" },
  { value: "direct", title: "直连", description: "显式绕过系统和环境代理。" }
];

export function UpdateSettingsModal(props: UpdateSettingsModalProps) {
  const [draft, setDraft] = useState(props.settings);
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (props.isOpen) {
      setDraft(props.settings);
      setLocalError("");
    }
  }, [props.isOpen, props.settings]);

  if (!props.isOpen) {
    return null;
  }

  const isBusy = props.state?.status === "checking" || props.state?.status === "downloading";

  async function saveSettings() {
    try {
      setIsSaving(true);
      setLocalError("");
      const saved = await props.bridge.saveSettings(draft);
      props.onSettingsChanged(saved);
      setDraft(saved);
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "保存更新设置失败。");
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function checkNow() {
    const saved = await saveSettings();
    if (!saved || saved.updatePolicy === "disabled") {
      return;
    }
    try {
      setLocalError("");
      props.onStateChanged(await props.bridge.checkForUpdates());
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "检查更新失败。");
    }
  }

  return (
    <div className="update-overlay" role="presentation">
      <section aria-labelledby="update-settings-title" aria-modal="true" className="update-dialog" role="dialog">
        <header className="update-dialog__header">
          <div>
            <div className="update-dialog__eyebrow">DV-EXPORT SETTINGS</div>
            <h2 id="update-settings-title">更新设置</h2>
          </div>
          <button className="update-dialog__close" onClick={props.onClose} title="关闭设置" type="button">
            ×
          </button>
        </header>

        <div className="update-dialog__body">
          <section className="update-setting-section">
            <h3>更新策略</h3>
            <div className="update-option-grid update-option-grid--three">
              {policyOptions.map((option) => (
                <label className={`update-option ${draft.updatePolicy === option.value ? "is-active" : ""}`} key={option.value}>
                  <input
                    checked={draft.updatePolicy === option.value}
                    name="update-policy"
                    onChange={() => setDraft((current) => ({ ...current, updatePolicy: option.value }))}
                    type="radio"
                  />
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="update-setting-section">
            <h3>更新网络</h3>
            <div className="update-option-grid update-option-grid--three">
              {networkOptions.map((option) => (
                <label
                  className={`update-option ${draft.updateNetworkMode === option.value ? "is-active" : ""}`}
                  key={option.value}
                >
                  <input
                    checked={draft.updateNetworkMode === option.value}
                    name="update-network-mode"
                    onChange={() => setDraft((current) => ({ ...current, updateNetworkMode: option.value }))}
                    type="radio"
                  />
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </label>
              ))}
            </div>
            <label className="update-proxy-input">
              <span>手动代理地址</span>
              <input
                disabled={draft.updateNetworkMode !== "manualProxy"}
                onChange={(event) => setDraft((current) => ({ ...current, manualProxyUrl: event.target.value }))}
                placeholder="http://127.0.0.1:7890"
                spellCheck={false}
                type="text"
                value={draft.manualProxyUrl}
              />
            </label>
          </section>

          <section className={`update-status update-status--${props.state?.status || "idle"}`}>
            <div className="update-status__heading">
              <strong>当前插件版本：{props.state?.currentVersion || "-"}</strong>
              {props.state?.availableVersion ? <span>最新版本：{props.state.availableVersion}</span> : null}
            </div>
            <div>{localError || props.state?.message || "更新服务尚未初始化。"}</div>
            {props.state?.status === "downloading" ? (
              <div className="update-progress" aria-label="更新下载进度">
                <span style={{ width: `${Math.round(props.state.progress * 100)}%` }} />
              </div>
            ) : null}
          </section>
        </div>

        <footer className="update-dialog__actions">
          <button className="action-button action-button--ghost" onClick={props.onClose} type="button">
            关闭
          </button>
          <button
            className="action-button action-button--ghost"
            disabled={isBusy || isSaving || draft.updatePolicy === "disabled"}
            onClick={() => void checkNow()}
            type="button"
          >
            {isBusy ? "检查中..." : "检查更新"}
          </button>
          <button
            className="action-button action-button--primary update-dialog__primary"
            disabled={isBusy || isSaving}
            onClick={() => void saveSettings()}
            type="button"
          >
            {isSaving ? "保存中..." : "保存设置"}
          </button>
        </footer>
      </section>
    </div>
  );
}
