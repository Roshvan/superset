{ pkgs, ... }:

{
  dotenv.disableHint = true;

  packages = [
    pkgs.bun
    pkgs.ripgrep
  ];

  scripts.devenv-tool-versions.exec = ''
    printf 'bun\t%s\n' "$(bun --version)"
    printf 'ripgrep\t%s\n' "$(rg --version | head -n 1)"
  '';

  enterTest = ''
    bun install --frozen-lockfile --ignore-scripts
    git diff --exit-code -- bun.lock
    bun run lint
    git diff --exit-code -- bun.lock
    bun run typecheck
    (cd apps/electric-proxy && bunx wrangler deploy --dry-run)
  '';
}
