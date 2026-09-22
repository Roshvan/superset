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
    # workerd's trusted postinstall provides the current platform binary when
    # Bun's cross-platform lock does not materialize its optional package.
    bun install --frozen-lockfile
    git diff --exit-code -- bun.lock
    bun run lint
    git diff --exit-code -- bun.lock
    bun run typecheck
    (cd apps/electric-proxy && bunx wrangler deploy --dry-run)
  '';
}
