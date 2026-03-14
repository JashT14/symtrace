import * as vscode from "vscode";

export interface SymtraceConfig {
  logicOnly: boolean;
  maxFileSize: number;
  maxAstNodes: number;
  maxRecursionDepth: number;
  parseTimeoutMs: number;
  noIncremental: boolean;
}

export function getConfig(): SymtraceConfig {
  const cfg = vscode.workspace.getConfiguration("symtrace");
  return {
    logicOnly: cfg.get<boolean>("logicOnly", false),
    maxFileSize: cfg.get<number>("maxFileSize", 5_242_880),
    maxAstNodes: cfg.get<number>("maxAstNodes", 200_000),
    maxRecursionDepth: cfg.get<number>("maxRecursionDepth", 2_048),
    parseTimeoutMs: cfg.get<number>("parseTimeoutMs", 2_000),
    noIncremental: cfg.get<boolean>("noIncremental", false),
  };
}
