import * as vscode from "vscode";
import { DiffOutput } from "../types";
import {
  SymtraceTreeItem,
  SummaryNode,
  FileNode,
  ClassificationNode,
  CrossFileSectionNode,
  PerformanceNode,
} from "./treeItems";

export class SymtraceTreeProvider
  implements vscode.TreeDataProvider<SymtraceTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SymtraceTreeItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private data: DiffOutput | undefined;
  private repoPath: string | undefined;

  setData(data: DiffOutput, repoPath: string): void {
    this.data = data;
    this.repoPath = repoPath;
    this._onDidChangeTreeData.fire(undefined);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.data = undefined;
    this.repoPath = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SymtraceTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SymtraceTreeItem): SymtraceTreeItem[] {
    if (!this.data) {
      return [];
    }

    if (!element) {
      return this.getRootChildren();
    }

    if ("getChildren" in element && typeof element.getChildren === "function") {
      return (element as { getChildren: () => SymtraceTreeItem[] }).getChildren();
    }

    return [];
  }

  private getRootChildren(): SymtraceTreeItem[] {
    const items: SymtraceTreeItem[] = [];
    const data = this.data!;
    const repoPath = this.repoPath!;

    // Commit classification badge
    if (data.commit_classification) {
      items.push(
        new ClassificationNode(
          data.commit_classification.primary_class,
          data.commit_classification.confidence_score
        )
      );
    }

    // Summary
    items.push(new SummaryNode(data));

    // File nodes
    for (const file of data.files) {
      items.push(new FileNode(file, data.commit_a, data.commit_b, repoPath));
    }

    // Cross-file tracking
    if (
      data.cross_file_tracking &&
      data.cross_file_tracking.cross_file_events.length > 0
    ) {
      items.push(new CrossFileSectionNode(data.cross_file_tracking));
    }

    // Performance metrics
    items.push(new PerformanceNode(data.performance));

    return items;
  }
}
