{
  description = "melzi.dev";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      each = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = each (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 pkgs.git pkgs.chromium ];
          env = {
            PLAYWRIGHT_CHROMIUM = "${pkgs.chromium}/bin/chromium";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };
          shellHook = ''[ -d node_modules ] || npm ci'';
        };
      });

      apps = each (pkgs: {
        dev = {
          type = "app";
          program = "${pkgs.writeShellApplication {
            name = "dev";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              [ -d node_modules ] || npm ci
              exec npm run dev -- "$@"
            '';
          }}/bin/dev";
        };
      });
    };
}
