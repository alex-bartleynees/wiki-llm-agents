{
  description = "wiki-agents — local-first wiki vault + agent workspace (placeholder name)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # Only for `checks`: builds a home-manager configuration with the module.
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, home-manager }:
    {
      # `services.wiki-agents`: the app as a user service (see nix/hm-module.nix).
      homeManagerModules.default = import ./nix/hm-module.nix self;
    }
    // flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodejs = pkgs.nodejs_22;

        atomicRenameSource = pkgs.writeText "wiki-agents-rename-noreplace.c" ''
          #define _GNU_SOURCE
          #include <errno.h>
          #include <fcntl.h>
          #include <stdio.h>

          int main(int argc, char **argv) {
            if (argc != 3) return 2;
            if (renameat2(AT_FDCWD, argv[1], AT_FDCWD, argv[2], RENAME_NOREPLACE) == 0) return 0;
            if (errno == EEXIST || errno == ENOTEMPTY) return 3;
            perror("renameat2");
            return 1;
          }
        '';
        atomicRename = pkgs.runCommand "wiki-agents-rename-noreplace" { nativeBuildInputs = [ pkgs.stdenv.cc ]; } ''
          mkdir -p "$out/bin"
          cc -Wall -Wextra -Werror ${atomicRenameSource} -o "$out/bin/wiki-agents-rename-noreplace"
        '';

        wiki-agents = pkgs.callPackage ./nix/package.nix { inherit nodejs atomicRename; };

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
          runtimeInputs = [ nodejs pkgs.process-compose atomicRename ];
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

        # The module evaluates and builds in a home-manager configuration like the hosts'.
        checks.hm-module =
          let
            home = home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                self.homeManagerModules.default
                {
                  home = {
                    username = "test";
                    homeDirectory = "/home/test";
                    stateVersion = "25.05";
                  };
                  services.wiki-agents = {
                    enable = true;
                    vaults = [ "/home/test/Documents/My Vault" ];
                    port = 4320;
                    watchPollMs = 2000;
                    providerEnv.withhold = [ "AWS_*" "NPM_TOKEN" ];
                    secretFiles = { github = "/run/secrets/github"; jira = "/run/secrets/jira"; };
                    secretsKey = "systemd-creds";
                    enableLinger = true;
                    desktopEntry = true;
                    browser.enable = true;
                  };
                }
              ];
            };
            unit = "${home.activationPackage}/home-files/.config/systemd/user/wiki-agents.service";
          in
          pkgs.runCommand "wiki-agents-hm-module" { } ''
            grep -q 'ExecStart=.*/bin/wiki-agents --vault .*/home/test/Documents/My Vault' ${unit}
            grep -q 'Environment="WIKI_AGENTS_PORT=4320"' ${unit}
            grep -q 'Environment="WIKI_AGENTS_WATCH_POLL_MS=2000"' ${unit}
            grep -q 'Environment="WIKI_AGENTS_PROVIDER_ENV_WITHHOLD=AWS_\*,NPM_TOKEN"' ${unit}
            grep -q 'Environment="WIKI_AGENTS_SECRET_FILES=github=/run/secrets/github,jira=/run/secrets/jira"' ${unit}
            grep -q 'Environment="WIKI_AGENTS_SECRETS_KEY=systemd-creds"' ${unit}
            grep -q 'Environment="WIKI_AGENTS_BROWSER_MCP=${pkgs.playwright-mcp}/bin/playwright-mcp"' ${unit}
            grep -q 'WantedBy=wiki-agents.target' ${unit}
            test -e ${home.activationPackage}/home-files/.config/systemd/user/wiki-agents.target
            test -e ${home.activationPackage}/home-path/share/applications/wiki-agents.desktop
            grep -q 'enable-linger' ${home.activationPackage}/activate
            touch $out
          '';

        apps.dev = {
          type = "app";
          program = "${dev}/bin/wiki-agents-dev";
        };

        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            atomicRename
            pkgs.python3 # node-gyp, for better-sqlite3
            pkgs.gcc
            pkgs.gnumake
            pkgs.process-compose
            pkgs.sqlite
            pkgs.git # project scans list files with git
          ];
          # UI tests use Nix's browsers; `@playwright/test` in apps/web must be the
          # same version as `playwright-driver` (apps/web/e2e/playwright.config.ts checks).
          PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
          PLAYWRIGHT_DRIVER_VERSION = pkgs.playwright-driver.version;
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
        };
      });
}
