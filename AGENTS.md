# AGENTS.md

The full repository guide (architecture, where each NEAR integration lives, how to run, test and verify claims, and rules for changes) is in **[CLAUDE.md](CLAUDE.md)**. Human-facing docs are in [README.md](README.md), and the claim → evidence map is in [docs/CLAIMS.md](docs/CLAIMS.md).

Quick start, with no keys needed:

```bash
npm ci
npm test               # 45 Vitest tests, all external calls mocked
npm run typecheck && npm run lint && npm run build
npm run contract:test  # 25 Rust tests (needs rustup; toolchain pinned in contract/rust-toolchain.toml)
npm run verify:sample  # offline re-check of a real NEAR AI Cloud attestation
npm run dev            # http://localhost:5173, frontend + /api, works without .env
```
