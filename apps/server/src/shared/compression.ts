import { HttpMiddleware, HttpRouter } from "effect/http";

export const isCompressibleContentType = (contentType: string): boolean => {
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  if (mime === "text/event-stream") return false;
  if (mime.startsWith("text/")) return true;
  if (
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/xml" ||
    mime === "application/manifest+json" ||
    mime === "application/wasm" ||
    mime === "image/svg+xml"
  ) {
    return true;
  }
  return mime.endsWith("+json") || mime.endsWith("+xml");
};

export const CompressionLive = HttpRouter.middleware(
  HttpMiddleware.compression({
    algorithms: ["br", "gzip"],
    minSize: 1024,
    compressible: isCompressibleContentType,
    levels: { br: 4, gzip: 6 },
  }),
  { global: true },
);
