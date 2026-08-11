{
  description = "talk-server: axum + SQLite backend for the Talk app";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    crane.url = "github:ipetkov/crane";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, crane, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        craneLib = crane.mkLib pkgs;

        commonArgs = {
          src = craneLib.cleanCargoSource ./.;
          strictDeps = true;
          # Compile-time checked queries use the committed .sqlx cache; no
          # live database is needed on the build machine.
          SQLX_OFFLINE = "true";
        };

        cargoArtifacts = craneLib.buildDepsOnly commonArgs;

        talk-server = craneLib.buildPackage (commonArgs // {
          inherit cargoArtifacts;
          # sqlx bundles its own sqlite; the binary is fully static except libc.
        });
      in
      {
        packages.default = talk-server;

        devShells.default = craneLib.devShell {
          packages = with pkgs; [ sqlx-cli rust-analyzer sqlite ];
        };

        checks.default = craneLib.buildPackage (commonArgs // {
          inherit cargoArtifacts;
          cargoExtraArgs = "--all-targets";
        });
      });
}
