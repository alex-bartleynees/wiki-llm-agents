/**
 * The image the providers' image fixtures send: a 64×64 red PNG, made here so the
 * recorders and the fakes use the same bytes without a binary file in the repo.
 */
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 64;

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const redSquare = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  // Each row: filter byte 0, then red pixels.
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(SIZE * 3, Buffer.from([0xe0, 0x10, 0x10]))]);
  const pixels = Buffer.concat(Array.from({ length: SIZE }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const RED_SQUARE = { name: "red-square.png", mime: "image/png", bytes: new Uint8Array(redSquare()) } as const;

/** What the image fixtures ask. */
export const IMAGE_PROMPT = "What colour is the attached image? Reply with just the colour, in one word.";

/** An image a recorded turn sent, known by its bytes' hash. */
export interface FixtureImage {
  readonly name: string;
  readonly mime: string;
  readonly sha256: string;
}

export const fixtureImage = (image: { readonly name: string; readonly mime: string; readonly bytes: Uint8Array }): FixtureImage => ({
  name: image.name,
  mime: image.mime,
  sha256: sha256(image.bytes),
});

/** Recorded image paths start with this instead of the temp folder they were sent from. */
export const ATTACHMENTS = "/__attachments__";
