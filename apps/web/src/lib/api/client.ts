import { Schema } from "effect";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** GET a same-origin API path and decode the body with the operation's response schema. */
export const getJson = async <S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<S["Type"]> => {
  const response = await fetch(path, { ...init, headers: { accept: "application/json" } });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return Schema.decodeUnknownPromise(schema)(await response.json());
};
