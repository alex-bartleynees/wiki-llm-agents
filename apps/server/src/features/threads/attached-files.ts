import { type Attachment, formatSize } from "@wiki-agents/contracts/attachments/model";

/**
 * What the agent is told about files sent with a message: not their content (a log
 * export can be many megabytes) but where they are, for it to read with its tools.
 * Empty when there are none.
 */
export const attachedFilesText = (files: ReadonlyArray<Attachment & { readonly path: string }>) =>
  files.length === 0
    ? ""
    : [
        "Attached files (kept by the app outside the vault and the working folders; read them with your tools, and don't copy them into the vault unless asked):",
        ...files.map((file) => `- ${JSON.stringify(file.path)} (${file.mime}, ${formatSize(file.size)})`),
      ].join("\n");
