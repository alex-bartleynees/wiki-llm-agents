import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@wiki-agents/contracts/attachments/model";
import { describe, expect, it } from "vitest";
import { admit, attachmentName, modelWithoutImages } from "./draft.ts";

const now = new Date(2026, 10, 15, 9, 30, 0);

/** A file that says it has `size` bytes without holding them. */
const sized = (name: string, size: number) => {
  const file = new File(["x"], name);
  Object.defineProperty(file, "size", { value: size });
  return file;
};

describe("attachmentName", () => {
  it("names pasted images by time, as the editor does", () => {
    expect(attachmentName({ name: "image.png", type: "image/png" }, true, now)).toBe("Pasted image 20261115093000.png");
  });

  it("keeps the name of a chosen image or any other file", () => {
    expect(attachmentName({ name: "IMG_0001.jpg", type: "image/jpeg" }, false, now)).toBe("IMG_0001.jpg");
    expect(attachmentName({ name: "query_data.csv", type: "text/csv" }, true, now)).toBe("query_data.csv");
    expect(attachmentName({ name: "", type: "application/octet-stream" }, true, now)).toBe("Pasted file");
  });
});

describe("admit", () => {
  it("takes files up to the size limit, and says which were too large", () => {
    const { accepted, refused } = admit([sized("small.csv", 10), sized("huge.log", MAX_ATTACHMENT_BYTES + 1)], 0);
    expect(accepted.map((file) => file.name)).toEqual(["small.csv"]);
    expect(refused).toBe("Not attached: huge.log is over 100.0 MB.");
  });

  it("takes only as many as the message has room for", () => {
    const files = Array.from({ length: 4 }, (_, index) => sized(`${index}.txt`, 1));
    const { accepted, refused } = admit(files, MAX_ATTACHMENTS - 2);
    expect(accepted.map((file) => file.name)).toEqual(["0.txt", "1.txt"]);
    expect(refused).toBe(`Not attached: a message takes up to ${MAX_ATTACHMENTS} files.`);
    expect(admit(files, 0).refused).toBeNull();
  });
});

describe("modelWithoutImages", () => {
  const models = [
    { id: "sees", name: "Sees", free: false, images: true },
    { id: "blind", name: "Blind", free: true, images: false },
  ];

  it("is the current model when it can't see images", () => {
    expect(modelWithoutImages(models, "blind")?.name).toBe("Blind");
  });

  it("is null for a model that sees images, or one that isn't known", () => {
    expect(modelWithoutImages(models, "sees")).toBeNull();
    expect(modelWithoutImages(models, null)).toBeNull();
    expect(modelWithoutImages(models, "other")).toBeNull();
  });
});
