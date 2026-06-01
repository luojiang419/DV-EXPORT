import { useEffect, useState } from "react";
import type { MediaPoolFolderNode } from "../../types/models";

interface FolderTreeProps {
  tree: MediaPoolFolderNode | null;
  selectedFolderId: string | null;
  onSelect(folderId: string): void;
}

function FolderBranch({
  node,
  selectedFolderId,
  onSelect,
  depth,
  expandedIds,
  onToggle
}: {
  node: MediaPoolFolderNode;
  selectedFolderId: string | null;
  onSelect(folderId: string): void;
  depth: number;
  expandedIds: Set<string>;
  onToggle(folderId: string): void;
}) {
  const isExpanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div className={`folder-tree__row ${selectedFolderId === node.id ? "is-active" : ""}`}>
        <button
          className={`folder-tree__toggle ${!hasChildren ? "is-placeholder" : ""}`}
          style={{ marginLeft: `${depth * 14 + 14}px` }}
          onClick={() => {
            if (hasChildren) {
              onToggle(node.id);
            }
          }}
          type="button"
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
        </button>
        <button
          className={`folder-tree__item ${selectedFolderId === node.id ? "is-active" : ""}`}
          onClick={() => {
            onSelect(node.id);
            if (hasChildren && !isExpanded) {
              onToggle(node.id);
            }
          }}
          type="button"
        >
          <span>{node.name}</span>
        </button>
      </div>
      {hasChildren && isExpanded ? (
        <ul className="folder-tree__list">
          {node.children.map((child) => (
            <FolderBranch
              key={child.id}
              node={child}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTree({ tree, selectedFolderId, onSelect }: FolderTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tree) {
      return;
    }

    setExpandedIds(new Set([tree.id]));
  }, [tree]);

  if (!tree) {
    return <div className="empty-panel">正在读取媒体池目录...</div>;
  }

  function toggleFolder(folderId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }

  return (
    <ul className="folder-tree__list">
      <FolderBranch
        node={tree}
        selectedFolderId={selectedFolderId}
        onSelect={onSelect}
        depth={0}
        expandedIds={expandedIds}
        onToggle={toggleFolder}
      />
    </ul>
  );
}
