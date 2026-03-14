import * as vscode from "vscode";
import {
  DiffOutput,
  FileDiff,
  OperationRecord,
  OperationType,
  CrossFileTracking,
  CrossFileMatch,
  RefactorPattern,
  PerformanceMetrics,
} from "../types";

export type SymtraceTreeItem =
  | SummaryNode
  | SummaryDetailNode
  | FileNode
  | OperationNode
  | CrossFileSectionNode
  | CrossFileEventNode
  | ClassificationNode
  | RefactorPatternNode
  | PerformanceNode;

export class SummaryNode extends vscode.TreeItem {
  constructor(private data: DiffOutput) {
    super("Summary", vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon("dashboard");
    this.contextValue = "summary";
  }

  getChildren(): SummaryDetailNode[] {
    const s = this.data.summary;
    return [
      new SummaryDetailNode("Files", s.total_files, "files"),
      new SummaryDetailNode("Inserts", s.inserts, "diff-added"),
      new SummaryDetailNode("Deletes", s.deletes, "diff-removed"),
      new SummaryDetailNode("Modifications", s.modifications, "diff-modified"),
      new SummaryDetailNode("Moves", s.moves, "arrow-both"),
      new SummaryDetailNode("Renames", s.renames, "diff-renamed"),
    ];
  }
}

export class SummaryDetailNode extends vscode.TreeItem {
  constructor(label: string, value: number | string, icon: string) {
    super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

export class FileNode extends vscode.TreeItem {
  constructor(
    private fileDiff: FileDiff,
    private readonly commitA: string,
    private readonly commitB: string,
    private readonly repoPath: string
  ) {
    super(fileDiff.file_path, vscode.TreeItemCollapsibleState.Expanded);
    const opCount = fileDiff.operations.length;
    this.description = `${opCount} operation${opCount !== 1 ? "s" : ""}`;
    this.iconPath = new vscode.ThemeIcon("file-code");
    this.contextValue = "file";
  }

  getChildren(): (OperationNode | RefactorPatternNode)[] {
    const ops = this.fileDiff.operations.map(
      (op) =>
        new OperationNode(
          op,
          this.fileDiff.file_path,
          this.commitA,
          this.commitB,
          this.repoPath
        )
    );
    const refactors = (this.fileDiff.refactor_patterns ?? []).map(
      (r) => new RefactorPatternNode(r)
    );
    return [...ops, ...refactors];
  }
}

function getOperationIcon(type: OperationType): vscode.ThemeIcon {
  switch (type) {
    case "INSERT":
      return new vscode.ThemeIcon(
        "diff-added",
        new vscode.ThemeColor("gitDecoration.addedResourceForeground")
      );
    case "DELETE":
      return new vscode.ThemeIcon(
        "diff-removed",
        new vscode.ThemeColor("gitDecoration.deletedResourceForeground")
      );
    case "MODIFY":
      return new vscode.ThemeIcon(
        "diff-modified",
        new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")
      );
    case "MOVE":
      return new vscode.ThemeIcon(
        "arrow-both",
        new vscode.ThemeColor("editorInfo.foreground")
      );
    case "RENAME":
      return new vscode.ThemeIcon(
        "diff-renamed",
        new vscode.ThemeColor("editorWarning.foreground")
      );
  }
}

export class OperationNode extends vscode.TreeItem {
  constructor(
    public readonly operation: OperationRecord,
    public readonly filePath: string,
    private readonly commitA: string,
    private readonly commitB: string,
    private readonly repoPath: string
  ) {
    super(
      `${operation.type} ${operation.entity_type}`,
      vscode.TreeItemCollapsibleState.None
    );

    this.iconPath = getOperationIcon(operation.type);
    this.description = operation.details;

    const loc = operation.new_location ?? operation.old_location ?? "";
    let tooltip = `${operation.type} ${operation.entity_type}: ${operation.details}`;
    if (loc) {
      tooltip += `\nLocation: ${loc}`;
    }
    if (operation.similarity) {
      tooltip += `\nSimilarity: ${operation.similarity.similarity_percent.toFixed(0)}% (${operation.similarity.change_intensity})`;
    }
    tooltip += `\n\nClick to open side-by-side diff`;
    this.tooltip = tooltip;

    // Click to open side-by-side diff view
    this.command = {
      command: "symtrace.showOperationDiff",
      title: "Show Diff",
      arguments: [filePath, commitA, commitB, repoPath],
    };
  }
}

export class ClassificationNode extends vscode.TreeItem {
  constructor(primaryClass: string, confidence: number) {
    super(
      `Commit: ${primaryClass}`,
      vscode.TreeItemCollapsibleState.None
    );
    this.description = `${(confidence * 100).toFixed(0)}% confidence`;
    this.iconPath = new vscode.ThemeIcon("tag");
    this.contextValue = "classification";
  }
}

export class RefactorPatternNode extends vscode.TreeItem {
  constructor(pattern: RefactorPattern) {
    const kindLabel = pattern.kind.replace(/_/g, " ");
    super(kindLabel, vscode.TreeItemCollapsibleState.None);
    this.description = `${pattern.description} (${(pattern.confidence * 100).toFixed(0)}%)`;
    this.iconPath = new vscode.ThemeIcon(
      "wand",
      new vscode.ThemeColor("charts.purple")
    );
    this.tooltip = `Refactor: ${kindLabel}\n${pattern.description}\nEntities: ${pattern.involved_entities.join(", ")}\nConfidence: ${(pattern.confidence * 100).toFixed(0)}%`;
    this.contextValue = "refactorPattern";
  }
}

export class CrossFileSectionNode extends vscode.TreeItem {
  constructor(private tracking: CrossFileTracking) {
    super("Cross-File Events", vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${tracking.cross_file_events.length} event${tracking.cross_file_events.length !== 1 ? "s" : ""}`;
    this.iconPath = new vscode.ThemeIcon("references");
    this.contextValue = "crossFileSection";
  }

  getChildren(): CrossFileEventNode[] {
    return this.tracking.cross_file_events.map(
      (ev) => new CrossFileEventNode(ev)
    );
  }
}

export class CrossFileEventNode extends vscode.TreeItem {
  constructor(event: CrossFileMatch) {
    const label =
      event.event === "cross_file_move"
        ? "Move"
        : event.event === "cross_file_rename"
          ? "Rename"
          : "API Change";
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = event.description;
    this.tooltip = `${event.old_symbol} (${event.old_file}) -> ${event.new_symbol} (${event.new_file})\nSimilarity: ${(event.similarity_score * 100).toFixed(0)}%`;

    const iconMap: Record<string, string> = {
      cross_file_move: "arrow-both",
      cross_file_rename: "diff-renamed",
      api_surface_change: "warning",
    };
    this.iconPath = new vscode.ThemeIcon(iconMap[event.event] ?? "circle");
  }
}

export class PerformanceNode extends vscode.TreeItem {
  constructor(private perf: PerformanceMetrics) {
    super("Performance", vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${perf.total_time_ms.toFixed(1)}ms total`;
    this.iconPath = new vscode.ThemeIcon("dashboard");
    this.contextValue = "performance";
  }

  getChildren(): SummaryDetailNode[] {
    const items: SummaryDetailNode[] = [
      new SummaryDetailNode(
        "Files processed",
        this.perf.total_files_processed,
        "files"
      ),
      new SummaryDetailNode(
        "Nodes compared",
        this.perf.total_nodes_compared,
        "symbol-number"
      ),
      new SummaryDetailNode(
        "Parse time",
        `${this.perf.parse_time_ms.toFixed(1)}ms`,
        "clock"
      ),
      new SummaryDetailNode(
        "Diff time",
        `${this.perf.diff_time_ms.toFixed(1)}ms`,
        "clock"
      ),
      new SummaryDetailNode(
        "Total time",
        `${this.perf.total_time_ms.toFixed(1)}ms`,
        "clock"
      ),
    ];
    if (this.perf.incremental_parses != null) {
      items.push(
        new SummaryDetailNode(
          "Incremental parses",
          this.perf.incremental_parses,
          "sync"
        )
      );
    }
    if (this.perf.nodes_reused != null) {
      items.push(
        new SummaryDetailNode("Nodes reused", this.perf.nodes_reused, "sync")
      );
    }
    return items;
  }
}
