import type {
  FrameRateConversionResponse,
  FrameRateConversionStrategy,
  FrameRateOption,
  TimelineEntry
} from "../../types/models";

interface FrameRateConversionPanelProps {
  selectedTimelines: TimelineEntry[];
  sourceFrameRateLabel: string;
  targetFrameRateInput: string;
  frameRateOptions: FrameRateOption[];
  destinationFolderName: string;
  conversionStrategy: FrameRateConversionStrategy;
  result: FrameRateConversionResponse | null;
  onTargetFrameRateChange(nextFrameRate: string): void;
  onDestinationFolderNameChange(nextFolderName: string): void;
  onConversionStrategyChange(nextStrategy: FrameRateConversionStrategy): void;
}

export function FrameRateConversionPanel({
  selectedTimelines,
  sourceFrameRateLabel,
  targetFrameRateInput,
  frameRateOptions,
  destinationFolderName,
  conversionStrategy,
  result,
  onTargetFrameRateChange,
  onDestinationFolderNameChange,
  onConversionStrategyChange
}: FrameRateConversionPanelProps) {
  const selectedPreview = selectedTimelines.slice(0, 4);
  const hiddenSelectedCount = Math.max(0, selectedTimelines.length - selectedPreview.length);
  const frameRateOptionsListId = "conversion-frame-rate-options";

  return (
    <div className="conversion-panel">
      <div className="conversion-panel__summary">
        <div>
          <span>已选时间线</span>
          <strong>{selectedTimelines.length}</strong>
        </div>
        <div>
          <span>原时间线帧率</span>
          <strong>{sourceFrameRateLabel}</strong>
        </div>
      </div>

      <label className="field">
        <span className="field__label">目标时间线帧率</span>
        <input
          className="field__control"
          inputMode="decimal"
          list={frameRateOptions.length > 0 ? frameRateOptionsListId : undefined}
          min="0.001"
          onChange={(event) => onTargetFrameRateChange(event.target.value)}
          placeholder="例如 50"
          step="0.001"
          type="number"
          value={targetFrameRateInput}
        />
        {frameRateOptions.length > 0 ? (
          <datalist id={frameRateOptionsListId}>
            {frameRateOptions.map((frameRate) => (
              <option key={frameRate.id} value={frameRate.value}>
                {frameRate.label}
              </option>
            ))}
          </datalist>
        ) : null}
      </label>

      <label className="field">
        <span className="field__label">新媒体夹名称</span>
        <input
          className="field__control"
          onChange={(event) => onDestinationFolderNameChange(event.target.value)}
          placeholder="留空则使用源媒体夹"
          type="text"
          value={destinationFolderName}
        />
      </label>

      <label className="field">
        <span className="field__label">复制方式</span>
        <select
          className="field__control"
          onChange={(event) => onConversionStrategyChange(event.target.value as FrameRateConversionStrategy)}
          value={conversionStrategy}
        >
          <option value="resolve-ui-copy-paste">模拟手动复制粘贴（实验）</option>
          <option value="resolve-render">内部 API 复制</option>
        </select>
      </label>

      <div className="conversion-panel__selection">
        {selectedPreview.length === 0 ? (
          <div className="empty-panel">未选择时间线。</div>
        ) : (
          selectedPreview.map((timeline) => (
            <div className="conversion-panel__timeline" key={timeline.id}>
              <span>{timeline.name}</span>
              <em>{timeline.frameRate ? `${timeline.frameRate} fps` : "未知帧率"}</em>
            </div>
          ))
        )}
        {hiddenSelectedCount > 0 ? <div className="conversion-panel__more">另有 {hiddenSelectedCount} 条</div> : null}
      </div>

      <FrameRateConversionResult result={result} />
    </div>
  );
}

function FrameRateConversionResult({ result }: { result: FrameRateConversionResponse | null }) {
  if (!result) {
    return <div className="empty-panel">创建后显示新时间线。</div>;
  }

  return (
    <div className="conversion-result">
      <div className="summary-panel__stats">
        <div>
          <strong>{result.converted}</strong>
          <span> 已创建</span>
        </div>
        <div>
          <strong>{result.skipped}</strong>
          <span> 已跳过</span>
        </div>
        <div>
          <strong>{result.failed}</strong>
          <span> 失败</span>
        </div>
      </div>

      <div className="summary-panel__list">
        {result.results.map((item) => (
          <div
            className={`summary-row ${
              item.status === "failed" ? "is-failed" : item.status === "skipped" ? "is-skipped" : "is-success"
            }`}
            key={`${item.timelineName}-${item.newTimelineId || item.newTimelineName || item.reason || item.status}`}
          >
            <div className="summary-row__title">{item.timelineName}</div>
            <div className="summary-row__detail">{formatConversionResultDetail(item)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatConversionResultDetail(item: FrameRateConversionResponse["results"][number]) {
  if (item.status === "converted") {
    const folderText = item.targetFolderName ? ` · 媒体夹：${item.targetFolderName}` : "";
    const frameRateText = item.targetFrameRate ? ` · ${item.targetFrameRate} fps` : "";
    return `新时间线：${item.newTimelineName || "-"}${frameRateText}${folderText}`;
  }

  return item.reason || "未完成转换。";
}
