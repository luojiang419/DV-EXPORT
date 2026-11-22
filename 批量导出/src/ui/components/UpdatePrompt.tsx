import type { UpdateState } from "../../types/update";

interface UpdatePromptProps {
  state: UpdateState;
  isBusy: boolean;
  onDefer(): void;
  onInstallNow(): void;
}

export function UpdatePrompt(props: UpdatePromptProps) {
  return (
    <div className="update-overlay update-overlay--prompt" role="presentation">
      <section aria-labelledby="update-prompt-title" aria-modal="true" className="update-dialog update-dialog--prompt" role="dialog">
        <div className="update-prompt__icon">↑</div>
        <div>
          <div className="update-dialog__eyebrow">UPDATE READY</div>
          <h2 id="update-prompt-title">更新已下载完成</h2>
          <p>
            新版本 {props.state.availableVersion} 已准备好。可以现在更新并重启，也可以安排到下次启动时更新。
          </p>
        </div>
        {props.state.releaseNotes ? (
          <div className="update-release-notes">
            <strong>版本说明</strong>
            <p>{props.state.releaseNotes}</p>
          </div>
        ) : null}
        <div className="update-prompt__actions">
          <button className="action-button action-button--ghost" disabled={props.isBusy} onClick={props.onDefer} type="button">
            下次启动更新
          </button>
          <button
            className="action-button action-button--primary update-dialog__primary"
            disabled={props.isBusy}
            onClick={props.onInstallNow}
            type="button"
          >
            {props.isBusy ? "正在准备..." : "立即更新"}
          </button>
        </div>
      </section>
    </div>
  );
}
