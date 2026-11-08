{
  description = "wiki-agents — local-first wiki vault + agent workspace (placeholder name)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodejs = pkgs.nodejs_22;

        wiki-agents = pkgs.callPackage ./nix/package.nix { inherit nodejs; };

        # One command for development: server in watch mode + Vite dev server.
        devConfig = pkgs.writeText "process-compose.yaml" (builtins.toJSON {
          version = "0.5";
          processes = {
            server = {
              command = "npm run dev --workspace @wiki-agents/server";
              readiness_probe.http_get = {
                host = "127.0.0.1";
                port = 4317;
                path = "/health";
              };
            };
            web = {
              command = "npm run dev --workspace @wiki-agents/web";
              depends_on.server.condition = "process_healthy";
            };
          };
        });

        dev = pkgs.writeShellApplication {
          name = "wiki-agents-dev";
          runtimeInputs = [ nodejs pkgs.process-compose ];
          text = ''
            if [ ! -d node_modules ]; then npm install; fi
            exec process-compose up --config ${devConfig} "$@"
          '';
        };
      in
      {
        packages = {
          inherit wiki-agents;
          default = wiki-agents;
        };

        apps.dev = {
          type = "app";
          program = "${dev}/bin/wiki-agents-dev";
        };

        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            pkgs.python3 # node-gyp, for better-sqlite3
            pkgs.gcc
            pkgs.gnumake
            pkgs.process-compose
            pkgs.sqlite
          ];
        };
      });
}
