import { Effect, type FileSystem } from "effect";
import { Toolkit } from "effect/ai";
import type { WallClock } from "../../shared/wall-clock.js";
import type { AgentCatalog } from "../agents/catalog.js";
import type { ChangeLog } from "../changes/change-log.js";
import type { Inbox } from "../inbox/inbox.js";
import type { VaultIndex } from "../indexing/vault-index.js";
import type { ProjectRepository } from "../projects/repository.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ScheduleRepository } from "../schedules/repository.js";
import type { SchedulerSignal } from "../schedules/signal.js";
import type { ThreadRepository } from "../threads/repository.js";
import type { ThreadActors } from "../threads/thread-actors.js";
import type { ThreadBus } from "../threads/thread-bus.js";
import type { VaultRepository } from "../vaults/repository.js";
import { ProjectIgnoredFiles, projectIgnoredFiles } from "./tools/project-ignored-files/tool.js";
import { VaultBacklinks, vaultBacklinks } from "./tools/vault-backlinks/tool.js";
import { VaultNoteInfo, vaultNoteInfo } from "./tools/vault-note-info/tool.js";
import { VaultOpenNote, vaultOpenNote } from "./tools/vault-open-note/tool.js";
import { VaultRecentChanges, vaultRecentChanges } from "./tools/vault-recent-changes/tool.js";
import { VaultResolveLink, vaultResolveLink } from "./tools/vault-resolve-link/tool.js";
import { VaultSearch, vaultSearch } from "./tools/vault-search/tool.js";
import { VaultStatus, vaultStatus } from "./tools/vault-status/tool.js";

import { ScheduleCreate, scheduleCreate } from "./tools/schedule-create/tool.js";
import { ScheduleDelete, scheduleDelete } from "./tools/schedule-delete/tool.js";
import { ScheduleList, scheduleList } from "./tools/schedule-list/tool.js";
import { SchedulePause, schedulePause } from "./tools/schedule-pause/tool.js";
import { ScheduleResume, scheduleResume } from "./tools/schedule-resume/tool.js";
import { ScheduleRunNow, scheduleRunNow } from "./tools/schedule-run-now/tool.js";
import { ScheduleUpdate, scheduleUpdate } from "./tools/schedule-update/tool.js";
import { VaultReadNote, vaultReadNote } from "./tools/vault-read-note/tool.js";
import { VaultRelated, vaultRelated } from "./tools/vault-related/tool.js";

/** The tools every agent gets, in the order they are listed: the vault tools, the project ones, then the schedule ones. */
export const VaultToolkit = Toolkit.make(
  VaultSearch,
  VaultNoteInfo,
  VaultBacklinks,
  VaultResolveLink,
  VaultOpenNote,
  VaultRecentChanges,
  VaultStatus,
  VaultReadNote,
  VaultRelated,
  ProjectIgnoredFiles,
  ScheduleCreate,
  ScheduleList,
  ScheduleUpdate,
  SchedulePause,
  ScheduleResume,
  ScheduleDelete,
  ScheduleRunNow,
);

export const VAULT_TOOL_NAMES: ReadonlyArray<string> = Object.keys(VaultToolkit.tools);

/** Services the handlers use, captured when the toolkit is built; the caller comes with each request. */
type HandlerServices =
  | VaultIndex
  | VaultRepository
  | FileSystem.FileSystem
  | ThreadActors
  | ThreadBus
  | ChangeLog
  | ThreadRepository
  | ProjectRepository
  | AgentCatalog
  | ProviderRegistry
  | ScheduleRepository
  | SchedulerSignal
  | Inbox
  | WallClock;

export const VaultToolkitLive = VaultToolkit.toLayer(
  Effect.gen(function* () {
    const services = yield* Effect.context<HandlerServices>();
    const withServices = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideContext(effect, services) as Effect.Effect<A, E, Exclude<R, HandlerServices>>;
    return VaultToolkit.of({
      vault_read_note: (params) => withServices(vaultReadNote(params)),
      vault_related: (params) => withServices(vaultRelated(params)),
      vault_search: (params) => withServices(vaultSearch(params)),
      vault_note_info: (params) => withServices(vaultNoteInfo(params)),
      vault_backlinks: (params) => withServices(vaultBacklinks(params)),
      vault_resolve_link: (params) => withServices(vaultResolveLink(params)),
      vault_open_note: (params) => withServices(vaultOpenNote(params)),
      vault_recent_changes: (params) => withServices(vaultRecentChanges(params)),
      vault_status: () => withServices(vaultStatus(VAULT_TOOL_NAMES)),
      project_ignored_files: () => withServices(projectIgnoredFiles()),
      schedule_create: (params) => withServices(scheduleCreate(params)),
      schedule_list: () => withServices(scheduleList()),
      schedule_update: (params) => withServices(scheduleUpdate(params)),
      schedule_pause: (params) => withServices(schedulePause(params)),
      schedule_resume: (params) => withServices(scheduleResume(params)),
      schedule_delete: (params) => withServices(scheduleDelete(params)),
      schedule_run_now: (params) => withServices(scheduleRunNow(params)),
    });
  }),
);
