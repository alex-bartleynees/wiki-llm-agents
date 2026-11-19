import { expect, test } from "@playwright/test";
import { projectFolder } from "./app.ts";

test("adds a project's browser sign-in from a thread's card link, with secrets chosen by name", async ({ page }, info) => {
  const response = await page.request.post("/api/projects", { data: { name: `Sign-ins ${info.project.name}`, workingDirectories: [projectFolder(info, "sign-ins")] } });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };
  // The account's values go in Settings › Secrets; the sign-in only names them.
  for (const name of ["e2e-demo-user", "e2e-demo-password"]) {
    expect((await page.request.put(`/api/secrets/${name}`, { data: { value: `${name}-value`, expiresAt: null } })).status()).toBe(200);
  }

  // As the thread's "needs a sign-in" card links to it: a new sign-in for the site, ready to fill in.
  await page.goto(`/projects/${project.id}?add-sign-in=Demo+local&origin=http%3A%2F%2Flocalhost%3A4200#browser-sign-ins`);
  const section = page.getByRole("region", { name: "Browser sign-ins" });
  await expect(section.getByLabel("Sign-in name")).toHaveValue("Demo local");
  await expect(section.getByLabel("Sites for Demo local")).toHaveValue("http://localhost:4200");
  const names = section.getByLabel("Name the agent types");
  await expect(names).toHaveCount(2);
  await expect(names.nth(0)).toHaveValue("DEMO_LOCAL_USER");
  await expect(names.nth(1)).toHaveValue("DEMO_LOCAL_PASSWORD");
  await expect(section.getByRole("list", { name: "To fix before saving" })).toContainText("choose a secret for DEMO_LOCAL_USER");
  await expect(section.getByRole("button", { name: "Save sign-ins" })).toBeDisabled();

  await section.getByLabel("Secret for DEMO_LOCAL_USER").selectOption("e2e-demo-user");
  await section.getByLabel("Secret for DEMO_LOCAL_PASSWORD").selectOption("e2e-demo-password");
  await section.getByRole("button", { name: "Save sign-ins" }).click();
  await expect(section.getByRole("status")).toHaveText("Saved.");
  await expect(section.getByRole("heading")).toHaveText("browser sign-ins · 1");

  // Saved on the server: the same link again doesn't start a second one for the site.
  await page.reload();
  await expect(section.getByLabel("Sign-in name")).toHaveCount(1);
  await expect(section.getByLabel("Secret for DEMO_LOCAL_PASSWORD")).toHaveValue("e2e-demo-password");
  // No value is ever on the page.
  await expect(page.locator("body")).not.toContainText("e2e-demo-password-value");

  await section.getByRole("button", { name: "Remove sign-in" }).click();
  await section.getByRole("button", { name: "Save sign-ins" }).click();
  await expect(section.getByRole("heading")).toHaveText("browser sign-ins · 0");
});
