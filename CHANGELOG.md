# Changelog

## [Unreleased]

### Added

- `ReactPlugin` serves the island loader and app bundles through the
  Autumn 0.8 `plugin_assets` API. The URLs are hashed and `immutable`.
  Each file has an SRI hash.
- `react_script()` and `react_bundle(&BUNDLE)` render `<script>` and
  `<link>` tags with SRI.
- `Island` renders the mount element. Props must be a JSON object
  (`PropsError`). Mount strategies are `Load`, `Idle` and `Visible`.
  `attr()` adds attributes. `inline()` renders a `<span>`.
- `PropsUpdate` sends new island props in an `HX-Trigger` (or
  `HX-Trigger-After-Settle`) header. It merges with other trigger events.
  React keeps the component state.
- `react-islands.js` mounts islands with `createRoot`. It follows htmx
  swaps with one `MutationObserver`. It puts the fallback back after a
  render crash. Each root gets a unique `identifierPrefix`. It needs
  React 19 or later.
- A reference frontend (esbuild + React 19), a demo app, browser tests and
  end-to-end tests.
