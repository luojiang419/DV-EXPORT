import type { ExportBatchResponse } from "../../types/models";

interface ExportSummaryProps {
  result: ExportBatchResponse | null;
  isExporting?: boolean;
  statusMessage?: string;
}

function buildResultSummary(result: ExportBatchResponse) {
  const failedText = result.failed > 0 ? `，失败 ${result.failed}` : "";
  return `已启动 ${result.startedJobs} 个任务，成功 ${result.succeeded}${failedText}`;
}

function buildResultDetail(result: ExportBatchResponse) {
  return result.results
    .map((item) => `${item.timelineName}: ${item.success ? `已加入队列，输出名 ${item.outputName}` : item.reason}`)
    .join("\n");
}

export function ExportSummary({ result, isExporting = false, statusMessage = "" }: ExportSummaryProps) {
  let content = statusMessage || "导出执行后，这里会显示任务结果汇总。";
  let title = content;

  if (isExporting) {
    content = "正在创建并启动本次批量任务...";
    title = content;
  }

  if (result) {
    content = buildResultSummary(result);
    title = buildResultDetail(result);
  }

  return (
    <div className="summary-panel">
      <div className="summary-panel__title">导出结果</div>
      <div className="summary-panel__status" title={title}>
        {isExporting ? <span className="loading-spinner" /> : null}
        <span>{content}</span>
      </div>
    </div>
  );
}
