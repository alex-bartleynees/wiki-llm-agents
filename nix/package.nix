{ lib, buildNpmPackage, nodejs, python3, makeWrapper }:

buildNpmPackage {
  pname = "wiki-agents";
  version = "0.1.0";

  src = lib.cleanSourceWith {
    src = ./..;
    filter = path: _type:
      let base = baseNameOf path; in
      !(builtins.elem base [ "node_modules" "dist" "build" ".svelte-kit" ".data" "result" "design" "test-results" "playwright-report" ".vitest" ]);
  };

  inherit nodejs;

  # Update after changing package-lock.json:
  #   nix run nixpkgs#prefetch-npm-deps package-lock.json
  npmDepsHash = "sha256-A/jBwmOMEZ8LTZCZqU9ba6XF3VEPdktPE0PgIPtuQG0=";

  # better-sqlite3 ships prebuilt binaries; python3 is only for its node-gyp fallback.
  nativeBuildInputs = [ python3 makeWrapper ];

  # Root "build" builds contracts, then the server, then the web app.
  npmBuildScript = "build";

  installPhase = ''
    runHook preInstall

    app=$out/lib/wiki-agents
    mkdir -p $app/apps/server $app/apps/web $app/packages/contracts $out/bin

    cp package.json $app/
    cp -r packages/contracts/package.json packages/contracts/dist $app/packages/contracts/
    cp -r apps/server/package.json apps/server/dist apps/server/drizzle $app/apps/server/
    cp -r apps/web/build $app/apps/web/

    # Production dependencies only (workspace links included).
    npm prune --omit=dev --no-audit --no-fund
    cp -r node_modules $app/
    # npm nests a dependency in a workspace when the root holds another version of it
    # (chokidar 6 for the server, while a dev tool hoists chokidar 4), so copy those too.
    for workspace in apps/server packages/contracts; do
      if [ -d $workspace/node_modules ]; then cp -r $workspace/node_modules $app/$workspace/; fi
    done

    makeWrapper ${nodejs}/bin/node $out/bin/wiki-agents \
      --add-flags "$app/apps/server/dist/index.js" \
      --set-default WIKI_AGENTS_STATIC_DIR "$app/apps/web/build" \
      --set-default WIKI_AGENTS_MIGRATIONS_DIR "$app/apps/server/drizzle"

    runHook postInstall
  '';

  meta = {
    description = "Local-first wiki vault and agent workspace";
    mainProgram = "wiki-agents";
    platforms = lib.platforms.linux;
  };
}
