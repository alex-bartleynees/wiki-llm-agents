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
        profile, the same one your terminal runs. The app needs OpenCode 2.2.x.
      '';
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      description = "Extra environment variables for the service.";
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
        ExecStart = lib.escapeShellArgs ([ (lib.getExe cfg.package) ] ++ lib.concatMap (vault: [ "--vault" vault ]) cfg.vaults);
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
