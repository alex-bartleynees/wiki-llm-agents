import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Schema } from "effect";

/*
 * The stored secrets file: envelope encryption with AES-256-GCM. A random data key
 * encrypts each secret; a key-encryption key from the key source wraps the data key,
 * so changing where the key comes from re-wraps one value and leaves the secrets as
 * they are. Names and dates are in the clear; values never are.
 */

export const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

const Encrypted = Schema.Struct({
  /** base64. */
  nonce: Schema.String,
  /** base64: the ciphertext followed by GCM's tag. */
  ciphertext: Schema.String,
});

export const SecretsFile = Schema.Struct({
  version: Schema.Literal(1),
  kek: Schema.Struct({
    source: Schema.Literals(["systemd-creds", "file"]),
    /** The data key, encrypted with the key-encryption key. */
    wrappedDek: Encrypted,
  }),
  secrets: Schema.Record(
    Schema.String,
    Schema.Struct({
      ...Encrypted.fields,
      createdAt: Schema.Number,
      expiresAt: Schema.NullOr(Schema.Number),
    }),
  ),
});
export type SecretsFile = typeof SecretsFile.Type;
type Encrypted = typeof Encrypted.Type;

export const newKey = () => randomBytes(KEY_BYTES);

/** Encrypts `plain` under `key`; `context` is bound to the result, so it only decrypts with the same context. */
export const seal = (key: Uint8Array, context: string, plain: Uint8Array): Encrypted => {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return { nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64") };
};

/** The plaintext, or undefined when the key or context is wrong or the data was changed. */
export const open = (key: Uint8Array, context: string, sealed: Encrypted): Buffer | undefined => {
  try {
    const data = Buffer.from(sealed.ciphertext, "base64");
    if (key.length !== KEY_BYTES || data.length < TAG_BYTES) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.nonce, "base64"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_BYTES)), decipher.final()]);
  } catch {
    return undefined;
  }
};

/** What a wrapped data key is bound to. */
export const DEK_CONTEXT = "wiki-agents-secrets:v1:dek";
/** What a secret's ciphertext is bound to: its name, so two secrets' ciphertexts can't be swapped. */
export const secretContext = (name: string) => `wiki-agents-secrets:v1:secret:${name}`;
