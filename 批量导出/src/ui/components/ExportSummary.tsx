import type { ExportBatchResponse } from "../../types/models";

interface ExportSummaryProps {
  result: ExportBatchResponse | null;
}

export function ExportSummary({ result }: ExportSummaryProps) {
  if (!result) {
    return <div className="empty-panel">导出执行后，这里会显示任务结果汇总。</div>;
  }

  return (
    <div className="summary-panel">
      <div className="summary-panel__stats">
        <div>
          <strong>{result.startedJobs}</strong>
          <span> 已启动任务</span>
        </div>
        <div>
          <strong>{result.succeeded}</strong>
          <span> 成功</span>
        </div>
        <div>
          <strong>{result.failed}</strong>
          <span> 失败</span>
        </div>
      </div>
      <div className="summary-panel__list">
        {result.results.map((item) => (
          <div key={`${item.timelineName}-${item.jobId ?? item.reason}`} className={`summary-row ${item.success ? "is-success" : "is-failed"}`}>
            <div className="summary-row__title">{item.timelineName}</div>
            <div className="summary-row__detail">
              {item.success ? `已加入队列，输出名：${item.outputName}` : item.reason}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
