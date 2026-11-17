import { Data, Effect } from "effect";

/**
 * Filling in the references in a server's headers and environment
 * (`${secret:github}`, `${env:NAME}`, `${file:/run/secrets/x}`) when the app connects.
 * Only the connection pool does this; the values go to the server and nowhere else.
 */

/** A reference couldn't be filled in. `reason` names the reference, never a value. */
export class ReferenceUnavailable extends Data.TaggedError("ReferenceUnavailable")<{ readonly reason: string }> {}

/** Where the values come from. */
export interface ReferenceSources {
  /** A secret's value: stored or declared. Fails with a reason that holds no value. */
  readonly secret: (name: string) => Effect.Effect<string, { readonly reason: string }>;
  /** The app's own environment (not the filtered one providers get: `${env:…}` is how a withheld variable reaches a server). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** A file's text. */
  readonly readFile: (path: string) => Effect.Effect<string, unknown>;
}

/** The values filled in, and every value a reference produced, so they can be redacted. */
export interface Resolved {
  readonly values: Record<string, string>;
  readonly used: ReadonlyArray<string>;
}

const REFERENCE = /\$\{([^}]*)\}/g;

/** `secret:github` → its value. The file's syntax was checked on loading, so anything else is unknown. */
const resolveOne = (sources: ReferenceSources, field: string, inner: string): Effect.Effect<string, ReferenceUnavailable> => {
  const colon = inner.indexOf(":");
  const kind = inner.slice(0, Math.max(colon, 0));
  const name = inner.slice(colon + 1);
  const unavailable = (why: string) => new ReferenceUnavailable({ reason: `${field}: \${${inner}} ${why}` });
  switch (kind) {
    case "secret":
      return sources.secret(name).pipe(Effect.mapError((error) => new ReferenceUnavailable({ reason: `${field}: ${error.reason}` })));
    case "env": {
      const value = sources.env[name];
      return value === undefined ? Effect.fail(unavailable("isn't set in the app's environment.")) : Effect.succeed(value);
    }
    case "file":
      return sources.readFile(name).pipe(
        // One trailing line break is the file's, not the value's (`echo token > file`).
        Effect.map((text) => text.replace(/\r?\n$/, "")),
        Effect.mapError(() => unavailable("can't be read.")),
      );
    default:
      return Effect.fail(unavailable("isn't a reference the app knows."));
  }
};

/**
 * Each value with its references filled in. `fieldPrefix` names the values in reasons
 * (`transport.env`), so Settings says which one to fix.
 */
export const resolveReferences = (sources: ReferenceSources, fieldPrefix: string, values: Readonly<Record<string, string>>): Effect.Effect<Resolved, ReferenceUnavailable> =>
  Effect.gen(function* () {
    const resolved: Record<string, string> = {};
    const used = new Set<string>();
    for (const [key, value] of Object.entries(values)) {
      let text = "";
      let last = 0;
      for (const match of value.matchAll(REFERENCE)) {
        const filled = yield* resolveOne(sources, `${fieldPrefix}.${key}`, match[1] ?? "");
        used.add(filled);
        text += value.slice(last, match.index) + filled;
        last = match.index + match[0].length;
      }
      resolved[key] = text + value.slice(last);
    }
    return { values: resolved, used: [...used] };
  });
