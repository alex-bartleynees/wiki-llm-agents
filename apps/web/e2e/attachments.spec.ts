import { expect, type Page, test } from "@playwright/test";
import { isPhone, openVault, tab, useReplay } from "./app.ts";

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

// A 1×1 PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const csv = "region,total\nnorth,120\nsouth,130\n";

test("sends an image and a CSV with a message, and shows both in the thread after a reload", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();

  const message = page.getByRole("textbox", { name: "Message" });
  const picker = page.getByLabel("Files to attach");
  const toSend = page.getByRole("list", { name: "Files to send" });
  let imageName: string;
  if (isPhone(info)) {
    // The Attach button: the photo library or camera on a phone.
    imageName = `photo ${info.project.name}.png`;
    await picker.setInputFiles({ name: imageName, mimeType: "image/png", buffer: png });
  } else {
    // A pasted screenshot is named by time, as in the editor.
    await message.evaluate((element, bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, [...png]);
    imageName = (await toSend.getByRole("img").getAttribute("alt")) ?? "";
    expect(imageName).toMatch(/^Pasted image \d{14}\.png$/);
  }
  await picker.setInputFiles({ name: "sales.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

  await expect(toSend.getByRole("listitem")).toHaveCount(2);
  await expect(toSend.getByRole("img", { name: imageName })).toBeVisible();
  await expect(toSend).toContainText("sales.csv");
  await expect(toSend).not.toContainText("uploading…");
  await noOverflow(page);

  const text = `What sold best? ${info.project.name}`;
  await message.fill(text);
  const sent = page.waitForResponse((response) => /\/api\/threads\/[^/]+\/messages$/.test(response.url()) && response.request().method() === "POST");
  await message.press("Enter");
  const threadId = /\/api\/threads\/([^/]+)\/messages$/.exec((await sent).url())?.[1];
  expect(threadId).toBeDefined();
  await expect(toSend).toBeHidden();

  // The replay agent says what reached it: the image as an image, the CSV as a file.
  await expect(page.getByText(`Replay received: image ${imageName} (image/png, ${png.length} B); file sales.csv (text/csv, ${csv.length} B).`)).toBeVisible();
  await expect(page.locator(".turn-end").last()).toHaveText(/^Done/);

  const vaultUrl = page.url().split("?")[0];
  await page.goto(`${vaultUrl}?thread=${threadId}`);
  const sentMessage = page.locator(".user").filter({ hasText: text });
  const attachments = sentMessage.getByRole("group", { name: "Attachments" });
  await expect(attachments.getByRole("img", { name: imageName })).toBeVisible();
  const download = attachments.getByRole("link", { name: /sales\.csv/ });
  await expect(download).toContainText(`${csv.length} B`);
  const served = await page.request.get((await download.getAttribute("href")) ?? "");
  expect(await served.text()).toBe(csv);

  // The thumbnail opens the image at full size.
  await attachments.getByRole("button", { name: `Show ${imageName}` }).click();
  const viewer = page.getByRole("dialog", { name: imageName });
  await expect(viewer.getByRole("img", { name: imageName })).toBeVisible();
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
  await noOverflow(page);
});

test("sends a file with no text, and drops a file removed before sending", async ({ page }, info) => {
  await openVault(page);
  await tab(page, info, "Chat");
  await useReplay(page);
  await page.getByRole("button", { name: "New thread", exact: true }).click();

  const picker = page.getByLabel("Files to attach");
  const toSend = page.getByRole("list", { name: "Files to send" });
  const send = page.getByRole("button", { name: "Send" });
  await expect(send).toBeDisabled();

  const log = `errors ${info.project.name}.log`;
  await picker.setInputFiles([
    { name: log, mimeType: "text/plain", buffer: Buffer.from("boom\n") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("keep out\n") },
  ]);
  await expect(toSend.getByRole("listitem")).toHaveCount(2);
  await toSend.getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(toSend.getByRole("listitem")).toHaveCount(1);
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByText(`Replay received: file ${log} (text/plain, 5 B).`)).toBeVisible();
  const sentMessage = page.locator(".user").last();
  await expect(sentMessage.getByRole("link", { name: new RegExp(log.replace(/[.]/g, "\\.")) })).toBeVisible();
  await expect(sentMessage).not.toContainText("notes.txt");
});
