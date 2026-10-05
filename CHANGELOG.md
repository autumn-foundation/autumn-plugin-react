# Changelog

## [Unreleased]

## [0.1.0]

### Added

- `ReactPlugin`: serves the island loader (`/static/_plugins/react/`) and
  app bundles through the Autumn 0.8 `plugin_assets` seam. Hashed URLs are
  `immutable`. Each file has an SRI hash.
- `react_script()` and `react_bundle(&BUNDLE)`: `<script>` and `<link>`
  tags with SRI.
- `Island`: a typed builder for the mount element. Props must be a JSON
  object (`PropsError`). Mount strategies: `Load`, `Idle`, `Visible`.
- `PropsUpdate`: new island props in an `HX-Trigger` header. React keeps
  the component state.
- `react-islands.js`: mounts islands with `createRoot`, follows htmx swaps
  with one `MutationObserver`, puts the fallback back after a render error,
  and gives each root a unique `identifierPrefix`.
- Reference frontend (esbuild + React 19), demo app, browser tests and
  end-to-end tests.
