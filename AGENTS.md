CURRENT PHASE: develop

# Path of Building fork: API and MCP package

This is LaserFocused's fork of Path of Building Community (Path of Exile 1). Upstream code stays untouched so upstream merges stay clean; everything we add lives under `api/`, written to be shippable as part of Path of Building (nothing personal or host-specific; see the spec). Personal tooling (market watch, dashboards, our deploy) lives in the private repository `LaserFocused-ee/poe-advisor`.

- Spec and work queue: `.lf/SPEC.md` (fork-local planning, never part of the shippable package). Progress: `api/docs/PROGRESS.md`.
- Branches: `lf/main` is our integration branch (upstream `dev` plus our package). `lf/3.30` carries upstream pull requests with 3.30 game data until upstream merges them. Never push to upstream. Never rewrite shared history.
- Never edit files outside `api/`, `.lf/`, this file and `.gitignore` additions. If upstream logic must be reached, wrap it from `api/lua/`; a patch to an upstream file needs a line in `api/docs/UPSTREAM-PATCHES.md` saying why no wrapper could do it.
- Process (Justin, 14 Nov 2026): no end-to-end test suites, no release evidence, no Linear. Checks are build, lint, type-check and the unit and worker tests under `api/server`. Work is tracked in `api/docs`.
- Game-publisher rules bind this project: read-only analysis and advice for one human player who acts by hand. Nothing here may automate game actions, trade messages, hideout travel, live-search buying, or read the game client, screen or clipboard. Network calls to the trade site happen only when the player asks, through the header-driven rate limiter.
- Game data and art belong to Grinding Gear Games. This project is not affiliated with or endorsed by Grinding Gear Games. No commercial use.
- No secrets in the repository. Environment is read in one config module; logging goes through the logger module.
