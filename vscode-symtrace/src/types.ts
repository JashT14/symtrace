// TypeScript interfaces mirroring the symtrace Rust JSON output (src/types.rs)

export type OperationType = "MOVE" | "RENAME" | "INSERT" | "DELETE" | "MODIFY";
export type EntityType = "function" | "class" | "variable" | "block" | "other";
export type ChangeIntensity = "low" | "medium" | "high";
export type CommitClass = "refactor" | "feature" | "bug_fix" | "cleanup" | "formatting_only" | "mixed";
export type RefactorKind = "extract_method" | "move_method" | "rename_variable";
export type CrossFileEventKind = "cross_file_move" | "cross_file_rename" | "api_surface_change";

export interface SimilarityScore {
  structure_similarity: number;
  token_similarity: number;
  node_count_delta: number;
  cyclomatic_delta: number;
  control_flow_changed: boolean;
  similarity_percent: number;
  change_intensity: ChangeIntensity;
}

export interface OperationRecord {
  type: OperationType;
  entity_type: EntityType;
  old_location?: string;
  new_location?: string;
  details: string;
  similarity?: SimilarityScore;
}

export interface RefactorPattern {
  kind: RefactorKind;
  description: string;
  involved_entities: string[];
  confidence: number;
}

export interface FileDiff {
  file_path: string;
  operations: OperationRecord[];
  refactor_patterns?: RefactorPattern[];
}

export interface DiffSummary {
  total_files: number;
  moves: number;
  renames: number;
  inserts: number;
  deletes: number;
  modifications: number;
}

export interface CrossFileMatch {
  event: CrossFileEventKind;
  old_symbol: string;
  old_file: string;
  new_symbol: string;
  new_file: string;
  similarity_score: number;
  description: string;
}

export interface CrossFileTracking {
  symbol_count: number;
  cross_file_events: CrossFileMatch[];
}

export interface CommitClassification {
  primary_class: CommitClass;
  confidence_score: number;
}

export interface PerformanceMetrics {
  total_files_processed: number;
  total_nodes_compared: number;
  parse_time_ms: number;
  diff_time_ms: number;
  total_time_ms: number;
  incremental_parses?: number;
  nodes_reused?: number;
}

export interface DiffOutput {
  repository: string;
  commit_a: string;
  commit_b: string;
  files: FileDiff[];
  summary: DiffSummary;
  cross_file_tracking?: CrossFileTracking;
  commit_classification?: CommitClassification;
  performance: PerformanceMetrics;
}
