import { parseArgs } from "node:util";
import { NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { makeAppLive } from "./app/layers.js";

const { values } = parseArgs({
  options: { vault: { type: "string", multiple: true } },
});

NodeRuntime.runMain(Layer.launch(makeAppLive({ vaults: values.vault ?? [] })));
