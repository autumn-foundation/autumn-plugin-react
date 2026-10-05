# CLAUDE.md - autumn-plugin-react

React islands for Autumn 0.8 apps, served through the `plugin_assets`
seam. Read `docs/plan.md` and `docs/adr/` first.

## Layout

| Path | Content |
| --- | --- |
| `assets/react-islands.js` | The loader. The only file in `REACT_ASSETS`. |
| `src/assets.rs` | `REACT_ASSETS` bundle (`PluginAssets::from_files`). |
| `src/plugin.rs` | `ReactPlugin`: loader bundle plus app bundles. |
| `src/island.rs` | `Island`, `MountWhen`, `PropsError`, `props_json`. |
| `src/update.rs` | `PropsUpdate`: ASCII-safe `HX-Trigger` header. |
| `src/tags.rs` | `react_script()`, `react_bundle()`. |
| `tests/` | Rust: serving, conformance, markup, properties, loader source. |
| `js-tests/` | Loader tests: real React 19 (development build) in Chromium. |
| `js-tests/e2e/` | The demo binary, real htmx, default CSP. |
| `frontend/` | Reference esbuild + React 19 project for the demo. |
| `examples/react_demo.rs`, `examples/islands/` | Demo app and its committed bundle. |

## Commands

- Lint: `cargo fmt --all && cargo clippy --all-targets -- -D warnings`
- Rust tests: `cargo test`
- Loader tests: `npm ci && npm test`
- End-to-end: `cargo build --example react_demo && npm run test:e2e`
- Rebuild the demo bundle: `npm run build:islands` (commit the output)
- Coverage: `cargo llvm-cov --all-targets --summary-only` (keep ≥ 85%)

## Rules

- `react-islands.js` must not use `eval`, `new Function`, `innerHTML`,
  `outerHTML`, `insertAdjacentHTML` or `document.write`.
  `tests/loader_source.rs` checks this.
- The loader never throws out of a scan. One bad island must not stop
  other islands.
- DOM calls in the loader use `Element.prototype` methods, so an element
  cannot clobber them.
- Props are always a JSON object. `Island` and `PropsUpdate` share
  `props_json`.
- A change to the attribute names, the events or the queue shape is a
  breaking change. Update README, `frontend/src/autumn-react.d.ts` and
  `tests/loader_source.rs` with it.
- Browser tests that wait for time use stubs (`requestIdleCallback`) or
  page events, not long sleeps.
- Write docs and comments in ASD-STE100: short sentences, active voice.
- Never bump the crate version unless the user asks for a release.
