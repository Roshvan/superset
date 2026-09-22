{ pkgs, ... }:

{
  dotenv.disableHint = true;

  packages = [
    pkgs.bun
    pkgs.ripgrep
  ];

  scripts.devenv-tool-versions.exec = ''
    printf 'bun\t%s\n' "$(bun --version)"
  '';

  enterTest = ''
    bun install --frozen-lockfile --ignore-scripts
    bun run lint
    bun run typecheck
    (cd apps/electric-proxy && bunx wrangler deploy --dry-run)
  '';
}
