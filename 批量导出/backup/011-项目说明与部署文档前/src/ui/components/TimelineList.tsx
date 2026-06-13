import type { TimelineEntry } from "../../types/models";

interface TimelineListProps {
  timelines: TimelineEntry[];
  selectedIds: string[];
  isLoading?: boolean;
  onSelect(timelineId: string, modifiers: { ctrlKey: boolean; shiftKey: boolean }): void;
}

export function TimelineList({ timelines, selectedIds, isLoading = false, onSelect }: TimelineListProps) {
  if (timelines.length === 0) {
    return (
      <div className="timeline-list-shell">
        {isLoading ? (
          <div className="timeline-list__loading">
            <span className="loading-spinner" />
            <span>正在读取时间线信息...</span>
          </div>
        ) : (
          <div className="empty-panel">当前文件夹内没有可识别的时间线。</div>
        )}
      </div>
    );
  }

  return (
    <div className="timeline-list-shell">
      {isLoading ? (
        <div className="timeline-list__loading">
          <span className="loading-spinner" />
          <span>正在读取时间线信息...</span>
        </div>
      ) : null}
      <div className={`timeline-list ${isLoading ? "is-loading" : ""}`}>
        {timelines.map((timeline, index) => {
          const selected = selectedIds.includes(timeline.id);
          return (
            <button
              key={timeline.id}
              type="button"
              className={`timeline-list__item ${selected ? "is-active" : ""}`}
              onClick={(event) =>
                onSelect(timeline.id, { ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey })
              }
            >
              <span className="timeline-list__index">{String(index + 1).padStart(2, "0")}</span>
              <span className="timeline-list__name">{timeline.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
