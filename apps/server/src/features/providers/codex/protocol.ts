/**
 * The part of the `codex app-server` protocol (v2, JSON-RPC 2.0 over stdio, one JSON
 * object per line) the adapter uses, written from the types Codex 0.166.0 generates
 * (`codex app-server generate-ts --out <dir>`). Only the fields read are listed;
 * Codex sends more. Check them against `generate-ts` after upgrading Codex.
 */

export type JsonRpcId = string | number;

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

/** A request (`id` and `method`), notification (`method` only) or response (`id` and `result` or `error`). */
export interface JsonRpcMessage {
  readonly id?: JsonRpcId;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: JsonRpcError;
}

export type AskForApproval = "untrusted" | "on-request" | "never";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** `thread/start`, and `thread/resume` with `threadId`. */
export interface ThreadParams {
  readonly cwd: string;
  readonly model?: string;
  readonly approvalPolicy: AskForApproval;
  readonly sandbox: SandboxMode;
  /** `config.toml` overrides as dotted keys, e.g. `mcp_servers.<name>`. */
  readonly config: Record<string, unknown>;
  readonly developerInstructions: string | null;
}

export interface ThreadResponse {
  readonly thread: { readonly id: string };
  readonly model: string;
}

export interface TurnStartResponse {
  readonly turn: { readonly id: string };
}

export type PatchChangeKind = { readonly type: "add" } | { readonly type: "delete" } | { readonly type: "update"; readonly move_path: string | null };

export interface FileUpdateChange {
  /** Absolute. */
  readonly path: string;
  readonly kind: PatchChangeKind;
  /** The file's content for `add` (and `delete`); a unified diff without file headers for `update`. */
  readonly diff: string;
}

export type CommandAction =
  | { readonly type: "read"; readonly command: string; readonly name: string; readonly path: string }
  | { readonly type: "listFiles"; readonly command: string; readonly path: string | null }
  | { readonly type: "search"; readonly command: string; readonly query: string | null; readonly path: string | null }
  | { readonly type: "unknown"; readonly command: string };

export type ItemStatus = "inProgress" | "completed" | "failed" | "declined";

export type ThreadItem =
  | { readonly type: "agentMessage"; readonly id: string; readonly text: string }
  | {
      readonly type: "commandExecution";
      readonly id: string;
      readonly command: string;
      readonly cwd: string;
      readonly status: ItemStatus;
      readonly commandActions: ReadonlyArray<CommandAction>;
      readonly aggregatedOutput: string | null;
      readonly exitCode: number | null;
    }
  | { readonly type: "fileChange"; readonly id: string; readonly changes: ReadonlyArray<FileUpdateChange>; readonly status: ItemStatus }
  | {
      readonly type: "mcpToolCall";
      readonly id: string;
      readonly server: string;
      readonly tool: string;
      readonly status: ItemStatus;
      readonly arguments: unknown;
      readonly result: { readonly content: ReadonlyArray<unknown> } | null;
      readonly error: { readonly message: string } | null;
    }
  | { readonly type: "webSearch"; readonly id: string; readonly query: string }
  | { readonly type: "imageView"; readonly id: string; readonly path: string }
  | { readonly type: "collabAgentToolCall"; readonly id: string; readonly tool: string; readonly status: ItemStatus; readonly prompt: string | null }
  | { readonly type: "userMessage" | "reasoning" | "plan" | "contextCompaction"; readonly id: string };

export interface TokenUsageBreakdown {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

export interface TurnError {
  readonly message: string;
  readonly additionalDetails: string | null;
}

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

/** Notifications the adapter reads, by method. */
export interface Notifications {
  readonly "item/started": { readonly item: ThreadItem; readonly turnId: string };
  readonly "item/completed": { readonly item: ThreadItem; readonly turnId: string };
  readonly "item/agentMessage/delta": { readonly itemId: string; readonly delta: string; readonly turnId: string };
  readonly "thread/tokenUsage/updated": { readonly turnId: string; readonly tokenUsage: { readonly last: TokenUsageBreakdown } };
  readonly "turn/completed": { readonly turn: { readonly id: string; readonly status: TurnStatus; readonly error: TurnError | null } };
  readonly "turn/plan/updated": {
    readonly turnId: string;
    readonly explanation: string | null;
    readonly plan: ReadonlyArray<{ readonly step: string; readonly status: "pending" | "inProgress" | "completed" }>;
  };
  readonly "mcpServer/startupStatus/updated": { readonly name: string; readonly status: string; readonly error: string | null };
}

export interface CommandApprovalParams {
  readonly itemId: string;
  readonly command?: string | null;
  readonly cwd?: string | null;
  readonly reason?: string | null;
  readonly commandActions?: ReadonlyArray<CommandAction> | null;
}

export interface FileChangeApprovalParams {
  readonly itemId: string;
  readonly reason?: string | null;
  readonly grantRoot?: string | null;
}

export interface PermissionsApprovalParams {
  readonly reason: string | null;
  readonly permissions: { readonly network: unknown; readonly fileSystem: unknown };
}

export interface UserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<{ readonly label: string }> | null;
}

export interface UserInputParams {
  readonly questions: ReadonlyArray<UserInputQuestion>;
}

export interface ElicitationParams {
  readonly serverName: string;
  readonly mode: string;
  readonly message: string;
  readonly requestedSchema?: { readonly properties?: Record<string, unknown> } | null;
}

/** Requests Codex sends the client and waits on, by method. */
export interface ServerRequests {
  readonly "item/commandExecution/requestApproval": CommandApprovalParams;
  readonly "item/fileChange/requestApproval": FileChangeApprovalParams;
  readonly "item/permissions/requestApproval": PermissionsApprovalParams;
  readonly "item/tool/requestUserInput": UserInputParams;
  readonly "mcpServer/elicitation/request": ElicitationParams;
}

export interface Model {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly hidden: boolean;
  readonly isDefault: boolean;
}

export interface ModelListResponse {
  readonly data: ReadonlyArray<Model>;
  readonly nextCursor: string | null;
}

export type Account =
  | { readonly type: "apiKey" }
  | { readonly type: "chatgpt"; readonly email: string | null; readonly planType: string }
  | { readonly type: string };

export interface AccountResponse {
  readonly account: Account | null;
  readonly requiresOpenaiAuth: boolean;
}
