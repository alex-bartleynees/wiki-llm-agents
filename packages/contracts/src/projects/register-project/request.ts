import { Schema } from "effect";

/**
 * POST /api/projects with this body. The project uses the shared vault: the vault
 * registered first (one shared vault for now; there is no vault picker).
 */
export const RegisterProjectRequest = Schema.Struct({
  name: Schema.String.check(Schema.isNonEmpty()),
  /** Absolute paths (`~/` allowed), main working directory first. */
  workingDirectories: Schema.Array(Schema.String.check(Schema.isNonEmpty())),
  /** Create missing working directories, once every other check has passed. */
  createDirectories: Schema.optionalKey(Schema.Boolean),
  /** An existing folder inside the shared vault, relative to its root. */
  notesFolder: Schema.optionalKey(Schema.String),
});
export type RegisterProjectRequest = typeof RegisterProjectRequest.Type;
