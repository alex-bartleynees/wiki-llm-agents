# home-manager module: wiki-agents as a user service, started by `wiki-agents.target`.
#
#   imports = [ wiki-agents.homeManagerModules.default ];
#   services.wiki-agents = {
#     enable = true;
#     enableLinger = true;                 # start at boot, keep running after logout
#     vaults = [ "/home/alexbn/Documents/obsidian-vault" ];
#     watchPollMs = 2000;                  # vault on virtiofs/SSHFS: no change events
#   };
#
# Logs: `journalctl --user -u wiki-agents`. Restart: `systemctl --user restart wiki-agents.target`.
# Rules and agents are not managed here: the app writes the defaults into `configDir`
# on its first start and you edit them there (they may be a Syncthing folder).
self:
{ config, lib, pkgs, ... }:

let
  cfg = config.services.wiki-agents;
  inherit (lib) mkEnableOption mkIf mkOption types;
  localRagAi = config.services.rag-ai or { };
  localRagAiEnabled = localRagAi.enable or false;
  registeredVaults =
    cfg.vaults
    ++ lib.optional (
      cfg.ragAi.enable && cfg.ragAi.vaultRoot != null && !(builtins.elem cfg.ragAi.vaultRoot cfg.vaults)
    ) cfg.ragAi.vaultRoot;
  url = "http://${cfg.host}:${toString cfg.port}";
in
{
  options.services.wiki-agents = {
    enable = mkEnableOption "wiki-agents, a local wiki vault and agent workspace";

    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.wiki-agents;
      defaultText = lib.literalExpression "wiki-agents.packages.\${system}.wiki-agents";
      description = "The wiki-agents package.";
    };

    vaults = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [ "/home/alexbn/Documents/obsidian-vault" ];
      description = ''
        Vault folders registered at every start (vaults added in the app stay too).
        The first vault registered is the shared vault projects use.
      '';
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      example = "10.0.0.2";
      description = ''
        Address to listen on. Keep the loopback default unless the browser runs on another
        machine you trust (e.g. a VM's address on a host-only network): there is no login
        yet, and the folder picker lists folder names anywhere this user can read.
      '';
    };

    port = mkOption {
      type = types.port;
      default = 4317;
      description = "Port to listen on. `nix run .#dev` uses 4317 too; pick another if both run on one machine.";
    };

    dataDir = mkOption {
      type = types.str;
      default = "${config.xdg.dataHome}/wiki-agents";
      defaultText = lib.literalExpression ''"''${config.xdg.dataHome}/wiki-agents"'';
      description = "The SQLite database and other app data.";
    };

    configDir = mkOption {
      type = types.str;
      default = "${config.xdg.configHome}/wiki-agents";
      defaultText = lib.literalExpression ''"''${config.xdg.configHome}/wiki-agents"'';
      description = ''
        Rules and agents (`rules/*.md`, `agents/*.md`), written with defaults on the first
        start into an empty folder. Point it at a Syncthing folder outside every vault to
        share agents between machines, and let it sync before the first start.
      '';
    };

    watchPollMs = mkOption {
      type = types.nullOr types.ints.positive;
      default = null;
      example = 2000;
      description = ''
        Check vault files at this interval instead of waiting for file system events.
        Needed when vault changes happen outside this machine's view of the files, e.g.
        a folder shared into a VM over virtiofs and edited on the host.
      '';
    };

    opencode = mkOption {
      type = types.nullOr types.package;
      default = null;
      description = ''
        OpenCode package for the OpenCode provider. Null uses `opencode` from your user
        profile, the same one your terminal runs. The app needs OpenCode 2.2.x or 2.3.x.
      '';
    };

    opencodeTodo = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Turn on OpenCode's experimental todowrite tool (`experimental.todo`) for the app's
        OpenCode server, so OpenCode threads show the agent's plan as a checklist. Off by
        default: it adds tool calls to multi-step turns, and OpenCode may change it.
      '';
    };

    claudeCode = mkOption {
      type = types.nullOr types.package;
      default = null;
      description = ''
        Claude Code package for the Claude Code provider. Null uses `claude` from your
        user profile, with your login. The app needs Claude Code 2.1.x.
      '';
    };

    codex = mkOption {
      type = types.nullOr types.package;
      default = null;
      description = ''
        Codex package for the Codex provider. Null uses `codex` from your user profile,
        with your login. The app needs Codex 0.166 or later.
      '';
    };

    browser = {
      enable = mkEnableOption ''
        the browser for frontend agents: the built-in `playwright` MCP server (Playwright
        MCP with headless Chromium), which agents get by listing `playwright` in their MCP
        servers. The app runs it headless with an in-memory profile per thread, in its own
        state folder, with the app's own addresses blocked and the tools that run code or
        read files left out. Sets `WIKI_AGENTS_BROWSER_MCP`
      '';
      package = mkOption {
        type = types.package;
        default = pkgs.playwright-mcp;
        defaultText = lib.literalExpression "pkgs.playwright-mcp";
        description = ''
          The Playwright MCP package. nixpkgs' comes with the Chromium of its own Playwright
          version, so nothing is downloaded at runtime. Another build must take Playwright
          MCP's flags (`--headless --isolated --output-dir --blocked-origins`); for anything
          else, write `mcp/playwright.yaml` in `configDir`, which replaces the built-in server.
        '';
      };
    };

    ragAi = {
      enable = mkOption {
        type = types.bool;
        default = localRagAiEnabled;
        defaultText = lib.literalExpression "config.services.rag-ai.enable or false";
        description = "Enable hybrid vault search. Defaults to true when rag-ai is enabled in this Home Manager configuration.";
      };

      url = mkOption {
        type = types.nullOr types.str;
        default = if localRagAiEnabled then "http://127.0.0.1:${toString localRagAi.port}" else null;
        defaultText = lib.literalExpression "the local rag-ai service URL, or null";
        example = "https://rag-ai.example.org";
        description = "Base URL of the rag-ai service.";
      };

      vaultRoot = mkOption {
        type = types.nullOr types.str;
        default = if localRagAiEnabled then localRagAi.docsDir else lib.head (cfg.vaults ++ [ null ]);
        defaultText = lib.literalExpression "the local rag-ai document directory, or the first configured vault";
        description = "Absolute path of the local vault indexed by rag-ai. Registered at startup when hybrid search is enabled.";
      };
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      description = "Extra environment variables for the service.";
    };

    providerEnv = {
      withhold = mkOption {
        type = types.listOf types.str;
        default = [ ];
        example = [ "AWS_*" "NPM_TOKEN" ];
        description = ''
          Environment variables of the service kept from OpenCode, Claude Code and Codex,
          and so from every command an agent runs. A trailing `*` matches a prefix. The
          app's own `WIKI_AGENTS_*` variables are always kept from them.
        '';
      };
      pass = mkOption {
        type = types.listOf types.str;
        default = [ ];
        example = [ "AWS_REGION" ];
        description = ''
          Environment variables passed to the providers anyway, over `withhold` and the
          `WIKI_AGENTS_*` rule. A trailing `*` matches a prefix.
        '';
      };
    };

    secretFiles = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = { github = "/run/secrets/github"; };
      description = ''
        Secrets MCP servers use as `''${secret:<name>}`, each a file holding the value
        (sops-nix, agenix, systemd credentials). The app reads the file when it connects
        and stores nothing; Settings lists them. Names are lowercase letters, digits and
        hyphens. Sets `WIKI_AGENTS_SECRET_FILES`.
      '';
    };

    protectedPaths = mkOption {
      type = types.listOf types.str;
      default = [ ".env" ".env.*" "!.env.example" ];
      example = [ ".env" ".env.*" "!.env.example" "!.env.sample" "*.pem" "~/.aws" ];
      description = ''
        What no agent may read or change, whatever its autonomy, on top of the secrets:
        a path (`/…` or `~/…`, a file or a folder and everything in it), a name pattern
        matched in any folder (`*` and `?` as wildcards, no `/`), or `!` and a name
        pattern for an exception. Enforced like the secret files: Codex's sandbox denies
        them, Claude Code's and OpenCode's tool checks refuse them, and commands naming
        them are refused (a best effort). `[ ]` protects nothing extra. Sets
        `WIKI_AGENTS_PROTECTED_PATHS`.
      '';
    };

    secretsKey = mkOption {
      type = types.enum [ "auto" "systemd-creds" "file" ];
      default = "auto";
      description = ''
        What protects the key of the secrets entered in Settings: `systemd-creds`
        (encrypted by systemd for this user on this machine; systemd 256 or later), `file`
        (a key file only you can read, under `$XDG_STATE_HOME/wiki-agents`), or `auto`
        for the first that works. Applies when the first secret is stored. Sets
        `WIKI_AGENTS_SECRETS_KEY`.
      '';
    };

    enableLinger = mkOption {
      type = types.bool;
      default = false;
      description = ''
        Keep this user's services running without a login (`loginctl enable-linger`), so
        the app starts at boot and keeps running after you log out. Set once on
        activation; on NixOS `users.users.<name>.linger` does the same.
      '';
    };

    desktopEntry = mkOption {
      type = types.bool;
      default = false;
      description = ''Add a "Wiki Agents" launcher that opens the app in the browser (desktops).'';
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = !cfg.ragAi.enable || (cfg.ragAi.url != null && cfg.ragAi.url != "");
        message = "services.wiki-agents.ragAi.url must be set when hybrid search is enabled without a local rag-ai service.";
      }
      {
        assertion = !cfg.ragAi.enable || (cfg.ragAi.vaultRoot != null && lib.hasPrefix "/" cfg.ragAi.vaultRoot);
        message = "services.wiki-agents.ragAi.vaultRoot must be an absolute path when hybrid search is enabled.";
      }
    ];

    systemd.user.targets.wiki-agents = {
      Unit.Description = "wiki-agents and its services";
      Install.WantedBy = [ "default.target" ];
    };

    systemd.user.services.wiki-agents = {
      Unit = {
        Description = "wiki-agents: wiki vault and agent workspace";
        PartOf = [ "wiki-agents.target" ];
      };
      Service = {
        ExecStart = lib.escapeShellArgs ([ (lib.getExe cfg.package) ] ++ lib.concatMap (vault: [ "--vault" vault ]) registeredVaults);
        # Quoted, so values with spaces stay whole.
        Environment = lib.mapAttrsToList (name: value: "\"${name}=${value}\"") (
          {
            WIKI_AGENTS_HOST = cfg.host;
            WIKI_AGENTS_PORT = toString cfg.port;
            WIKI_AGENTS_DATA_DIR = cfg.dataDir;
            WIKI_AGENTS_CONFIG_DIR = cfg.configDir;
            # systemd's PATH is minimal; agents run commands, so give them the user's tools.
            PATH = lib.concatStringsSep ":" [
              "/etc/profiles/per-user/${config.home.username}/bin"
              "${config.home.profileDirectory}/bin"
              "/run/wrappers/bin"
              "/run/current-system/sw/bin"
              # Standalone home-manager on another Linux (e.g. Ubuntu): the system's tools.
              "/usr/local/bin"
              "/usr/bin"
              "/bin"
            ];
          }
          // lib.optionalAttrs (cfg.watchPollMs != null) { WIKI_AGENTS_WATCH_POLL_MS = toString cfg.watchPollMs; }
          // lib.optionalAttrs (cfg.opencode != null) { WIKI_AGENTS_OPENCODE = lib.getExe cfg.opencode; }
          // lib.optionalAttrs cfg.opencodeTodo { WIKI_AGENTS_OPENCODE_TODO = "true"; }
          // lib.optionalAttrs (cfg.claudeCode != null) { WIKI_AGENTS_CLAUDE = lib.getExe cfg.claudeCode; }
          // lib.optionalAttrs (cfg.codex != null) { WIKI_AGENTS_CODEX = lib.getExe cfg.codex; }
          // lib.optionalAttrs cfg.browser.enable { WIKI_AGENTS_BROWSER_MCP = lib.getExe cfg.browser.package; }
          // lib.optionalAttrs (cfg.providerEnv.withhold != [ ]) {
            WIKI_AGENTS_PROVIDER_ENV_WITHHOLD = lib.concatStringsSep "," cfg.providerEnv.withhold;
          }
          // lib.optionalAttrs (cfg.providerEnv.pass != [ ]) {
            WIKI_AGENTS_PROVIDER_ENV_PASS = lib.concatStringsSep "," cfg.providerEnv.pass;
          }
          // lib.optionalAttrs (cfg.secretFiles != { }) {
            WIKI_AGENTS_SECRET_FILES = lib.concatStringsSep "," (lib.mapAttrsToList (name: path: "${name}=${path}") cfg.secretFiles);
          }
          // lib.optionalAttrs (cfg.secretsKey != "auto") { WIKI_AGENTS_SECRETS_KEY = cfg.secretsKey; }
          // { WIKI_AGENTS_PROTECTED_PATHS = lib.concatStringsSep "," cfg.protectedPaths; }
          // lib.optionalAttrs (cfg.ragAi.enable && cfg.ragAi.url != null && cfg.ragAi.vaultRoot != null) {
            WIKI_AGENTS_RAG_AI_URL = cfg.ragAi.url;
            WIKI_AGENTS_RAG_AI_VAULT_ROOT = cfg.ragAi.vaultRoot;
          }
          // cfg.environment
        );
        Restart = "on-failure";
        RestartSec = 5;
      };
      Install.WantedBy = [ "wiki-agents.target" ];
    };

    # Lingering is per user and survives reboots; only ask for it when it isn't set.
    home.activation.wiki-agents-linger = mkIf cfg.enableLinger (
      lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        if [ ! -e "/var/lib/systemd/linger/$USER" ]; then
          run ${pkgs.systemd}/bin/loginctl enable-linger "$USER" \
            || warnEcho "wiki-agents: could not enable lingering for $USER; the app starts only while you are logged in"
        fi
      ''
    );

    xdg.desktopEntries = mkIf cfg.desktopEntry {
      wiki-agents = {
        name = "Wiki Agents";
        comment = "Wiki vault and agent workspace";
        exec = "${pkgs.xdg-utils}/bin/xdg-open ${url}";
        terminal = false;
        categories = [ "Office" ];
      };
    };
  };
}
