import { Schema } from "effect";

export const NullableHash = Schema.NullOr(Schema.String);
export const Destination = Schema.Struct({ label: Schema.String, path: Schema.String, resolvedPath: Schema.optional(Schema.String) });
export const Settings = Schema.Struct({ library: Schema.String, libraryResolvedPath: Schema.optional(Schema.String), destinations: Schema.Array(Destination) });
export const SettingsView = Schema.Struct({ settings: Schema.NullOr(Settings), defaults: Settings, hash: NullableHash });
const ResolvedPath = Schema.Struct({ enteredPath: Schema.String, resolvedPath: Schema.NullOr(Schema.String) });
export const SettingsPreview = Schema.Struct({
  library: ResolvedPath,
  destinations: Schema.Array(Schema.Struct({ label: Schema.String, ...ResolvedPath.fields })),
  diagnostics: Schema.Array(Schema.Struct({ kind: Schema.Literals(["alias", "overlap", "invalid"]), message: Schema.String })),
});
export const PhysicalDestination = Schema.Struct({ path: Schema.String, labels: Schema.Array(Schema.String) });
export const Summary = Schema.Struct({ name: Schema.String, skillPath: Schema.String, description: Schema.String, path: Schema.String });
export const Catalog = Schema.Struct({
  skills: Schema.Array(Summary),
  problems: Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
});
export const InstallAction = Schema.Literals(["install", "update", "remove", "rollback"]);
const BundleDifference = Schema.Struct({
  path: Schema.String,
  kinds: Schema.Array(Schema.Literals(["content", "permissions", "entry type", "only installed", "only library"])),
});
export type BundleDifference = typeof BundleDifference.Type;
export const InstallTarget = Schema.Struct({
  destination: PhysicalDestination,
  path: Schema.String,
  status: Schema.Literals(["absent", "installed", "update available", "modified", "external installed", "external differs", "unmanaged", "missing", "conflict"]),
  actions: Schema.Array(InstallAction),
  problem: Schema.optional(Schema.String),
  differences: Schema.optional(Schema.Array(BundleDifference)),
  needsRecovery: Schema.optional(Schema.Boolean),
});
export const Detail = Schema.Struct({
  ...Summary.fields,
  version: Schema.optional(Schema.String),
  content: Schema.String,
  hash: Schema.String,
  files: Schema.Array(Schema.String),
  targets: Schema.Array(InstallTarget),
});
export const Review = Schema.Struct({
  path: Schema.String,
  token: Schema.String,
  before: Schema.String,
  after: Schema.String,
  files: Schema.Array(Schema.Struct({
    path: Schema.String,
    kind: Schema.Literals(["added", "removed", "changed"]),
  })),
});
export type Settings = typeof Settings.Type;
export type SettingsPreview = typeof SettingsPreview.Type;
export type PhysicalDestination = typeof PhysicalDestination.Type;
export type Destination = typeof Destination.Type;
export type InstallAction = typeof InstallAction.Type;
export type InstallTarget = typeof InstallTarget.Type;
export type Detail = typeof Detail.Type;
export type Review = typeof Review.Type;
