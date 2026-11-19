import type { BrowserSignIn } from "@wiki-agents/contracts/projects/model";

/** A credential row as edited: `key` keeps Svelte's rows apart. */
export interface CredentialForm {
  readonly key: string;
  variable: string;
  secret: string;
}

/** A sign-in as edited: sites one per line. */
export interface SignInForm {
  readonly key: string;
  name: string;
  origins: string;
  credentials: Array<CredentialForm>;
}

const key = () => crypto.randomUUID();

export const signInToForm = (signIn: BrowserSignIn): SignInForm => ({
  key: key(),
  name: signIn.name,
  origins: signIn.origins.join("\n"),
  credentials: signIn.credentials.map((credential) => ({ key: key(), ...credential })),
});

/** What the form saves: blank sites and credentials left out, the rest as typed (the server trims). */
export const signInFromForm = (form: SignInForm): BrowserSignIn => ({
  name: form.name,
  origins: form.origins
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== ""),
  credentials: form.credentials
    .filter((credential) => credential.variable.trim() !== "" || credential.secret !== "")
    .map((credential) => ({ variable: credential.variable.trim(), secret: credential.secret })),
});

/** `My app (local)` → `MY_APP_LOCAL`: the start of the names its credentials suggest. */
export const variablePrefix = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .toUpperCase()
    .slice(0, 50);

/** A new sign-in for `site`, with a username and a password to fill in. */
export const blankSignIn = (site: string, origin: string): SignInForm => {
  const prefix = variablePrefix(site) || "SITE";
  return {
    key: key(),
    name: site,
    origins: origin,
    credentials: [
      { key: key(), variable: site === "" ? "" : `${prefix}_USER`, secret: "" },
      { key: key(), variable: site === "" ? "" : `${prefix}_PASSWORD`, secret: "" },
    ],
  };
};
