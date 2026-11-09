import { Schema } from "effect";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const decodeResponse = async <S extends Schema.ConstraintDecoder<unknown>>(response: Response, schema: S) => {
  if (!response.ok) throw new ApiError(response.status, (await response.text()) || response.statusText);
  return Schema.decodeUnknownPromise(schema)(await response.json()) as Promise<S["Type"]>;
};

/** GET a same-origin API path and decode the body with the operation's response schema. */
export const getJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  signal?: AbortSignal,
): Promise<S["Type"]> =>
  decodeResponse(await fetch(path, { headers: { accept: "application/json" }, signal: signal ?? null }), schema);

/** POST a request encoded with the operation's request schema; decode the response. */
export const postJson = async <R extends Schema.ConstraintCodec<unknown, unknown>, S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  request: R,
  body: R["Type"],
  schema: S,
): Promise<S["Type"]> => {
  const encoded = await Schema.encodeUnknownPromise(request)(body);
  const response = await fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(encoded),
  });
  return decodeResponse(response, schema);
};

/** DELETE a same-origin API path (parameters in the query string); decode the response. */
export const deleteJson = async <S extends Schema.ConstraintDecoder<unknown>>(path: string, schema: S): Promise<S["Type"]> =>
  decodeResponse(await fetch(path, { method: "DELETE", headers: { accept: "application/json" } }), schema);

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message !== "" ? error.message : fallback;

export const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
