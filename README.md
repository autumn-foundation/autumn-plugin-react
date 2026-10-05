# autumn-plugin-react

React islands for [Autumn](https://github.com/autumn-foundation/autumn)
0.8 apps. Put React 19 components into Maud + htmx pages. No Node at run
time.

- The plugin serves a small loader through the Autumn `plugin_assets`
  API: hashed URLs, `immutable` cache, SRI.
- Your bundler builds your components. The plugin serves that bundle the
  same way.
- The loader mounts islands that htmx swaps in, and unmounts islands that
  htmx swaps out.
- The server can send new props. React keeps the component state.
- No inline script and no `eval`. The default CSP (`script-src 'self'`)
  works.

## Install

```toml
[dependencies]
autumn-plugin-react = "0.1"
```

The loader needs React 19 or later. It uses the React 19 root option
`onUncaughtError` to show the fallback after a render crash.

## Use

### 1. Build the components

The entry file registers your components on `window.autumnReact`. The
loader can run before or after this file.

```jsx
// frontend/src/main.jsx
import { createElement, version } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { Counter } from "./Counter.jsx";

let queue;
try {
  queue = window.autumnReact;
  // An element or a frame named "autumnReact" can replace the global.
  if (!Array.isArray(queue) && queue?.loader !== true) queue = undefined;
} catch {
  queue = undefined; // A cross-origin frame throws on access.
}
if (!queue) queue = window.autumnReact = [];
queue.push({ createElement, createRoot, flushSync, version, components: { Counter } });
```

- `flushSync` is optional. With it, the loader events fire after React
  commits the DOM. Without it, they fire when the render starts.
- `version` is optional. With it, the loader refuses React before 19.

Build one classic script (no chunks):

```sh
esbuild frontend/src/main.jsx --bundle --format=iife --minify \
  --jsx=automatic --define:process.env.NODE_ENV='"production"' \
  --outfile=islands/islands.js
```

A Vite build or esbuild `--format=esm` gives an ES module. Name that file
`.mjs`: `react_bundle` renders `<script type="module">` for `.mjs` and a
classic `<script defer>` for `.js`.

[`frontend/`](https://github.com/autumn-foundation/autumn-plugin-react/tree/main/frontend)
is a complete reference project. Types for the registration API are in
`frontend/src/autumn-react.d.ts`.

### 2. Install the plugin and the bundle

```rust,ignore
use autumn_plugin_react::{Island, ReactPlugin, react_bundle, react_script};
use autumn_web::assets::PluginAssets;
use autumn_web::prelude::*;

static ISLANDS: PluginAssets = PluginAssets::from_files(
    "app-islands",
    &[("islands.js", include_bytes!("../islands/islands.js"))],
);

#[get("/")]
async fn index() -> AutumnResult<Markup> {
    let counter = Island::new("Counter")
        .props(&serde_json::json!({ "start": 3 }))?
        .attr("aria-label", "Counter")?
        .fallback(html! { p { "Count: 3" } });
    Ok(html! {
        html {
            head { (react_script()) (react_bundle(&ISLANDS)) }
            body { (counter) }
        }
    })
}

#[autumn_web::main]
async fn main() {
    autumn_web::app()
        .plugin(ReactPlugin::new().bundle(&ISLANDS))
        .routes(routes![index])
        .run()
        .await;
}
```

- `react_bundle` renders a `<link>` for each `.css` file, a
  `<script defer>` for each `.js` file and a `<script type="module">` for
  each `.mjs` file. Give the same bundle to `ReactPlugin::bundle`, or the
  URLs give `404`.
- Load the loader with `defer` (as `react_script` does).
- `Island::inline()` renders a `<span>` for an island in a `<p>` or a
  `<button>`. `Island::attr` adds attributes such as `role` or
  `aria-label`. It refuses `id`, `class`, `data-react-*` and `on*`.
- Two different bundles with one namespace stop the app at start-up.

### 3. Send new props from the server

```rust,ignore
use autumn_plugin_react::PropsUpdate;

#[post("/basket")]
async fn add_item() -> AutumnResult<(PropsUpdate, Markup)> {
    let update = PropsUpdate::new().set("#basket", &serde_json::json!({ "items": 3 }))?;
    Ok((update, html! {}))
}
```

`PropsUpdate` writes the `HX-Trigger` header. htmx sends the
`autumn:react:props` event. The loader sets `data-react-props` on the
island, and React renders the same root again.

- htmx handles `HX-Trigger` before the swap. To update an island that the
  same response swaps in, use `.after_settle()`.
- The update merges with a trigger header that the response already has.
  If later code replaces the header, call `PropsUpdate::apply_to` last.
- Each selector updates the first matching island. Build selectors from
  trusted values.
- Keep header props small. Proxies limit header size.

App code can send the same event:

```js
island.dispatchEvent(new CustomEvent("autumn:react:props", {
  bubbles: true,
  detail: { props: { items: 4 } },
}));
```

## The island element

```html
<div data-react-island="Counter" data-react-props='{"start":3}'
     data-react-mount="visible">fallback</div>
```

| Attribute | Set by | Meaning |
| --- | --- | --- |
| `data-react-island` | `Island::new` | The registered component name. A change mounts a new root. |
| `data-react-props` | `Island::props` | A JSON object. A change renders the same root again. |
| `data-react-mount` | `Island::mount_when` | `idle` or `visible`. No attribute: mount at load. |
| `data-react-state` | the loader | `waiting`, `pending` (name not registered yet), `mounted` or `error`. |
| `data-react-ignore` | you | No island in this element mounts. |

The loader sends these events. They bubble from the island. An island
that left the page sends `unmount` on `document`. `detail` has `name` and
`element` (and `error` for `error`):

| Event | When |
| --- | --- |
| `autumn:react:mount` | The root renders for the first time. |
| `autumn:react:update` | New props render. |
| `autumn:react:unmount` | The root unmounts. |
| `autumn:react:error` | Bad props, a mount error or a render crash. |

## Behavior

- **Mount.** The loader moves the fallback out of the island, then calls
  `createRoot` with a unique `identifierPrefix`. There is no hydration:
  Rust cannot render React.
- **Unknown name.** The island stays `pending` and shows its fallback. A
  later registration mounts it.
- **Errors.** Bad props or a failed mount keep the fallback. A render crash
  puts the fallback back. Bad props on a mounted island keep the last good
  render. Each error affects one island only.
- **htmx.** One `MutationObserver` mounts added islands and unmounts
  removed islands. An island that moves in one task keeps its root. An
  unmounted island gets its fallback back.
- **History.** After an htmx history restore, the loader removes the old
  React output and mounts the island again.
- **Nesting.** An island inside another island does not mount. React owns
  the outer island's DOM.
- **Morphs.** Do not morph the children of a mounted island (idiomorph).
  Swap it with `outerHTML`, or send new props.

## Security

- **User HTML.** The loader mounts each `data-react-island` element in the
  page. If your app shows user HTML, the sanitizer **must** remove
  `data-react-*`, `hx-*` and `data-hx-*` attributes. `data-react-ignore`
  alone is not sufficient: an htmx out-of-band swap (`hx-swap-oob`) can
  move an element out of it.
- **Props.** Props are in an HTML attribute. Maud escapes them. The loader
  reads them with `JSON.parse` and refuses a `__proto__` key. Do not put
  secrets in props. Do not spread untrusted props onto DOM elements
  (`<div {...props}>`): `dangerouslySetInnerHTML` or `href` in props can
  then inject script.
- **Updates.** Any same-origin script and any `HX-Trigger` header can send
  `autumn:react:props`. Do not copy user input into a trigger header.
- **Names.** The first registration of a name stays. A library bundle
  must use a prefix in its component names (`Acme.Chart`).
- Component names, `id`, `class`, extra attributes and `PropsUpdate`
  selectors are trusted input from your code.

## Demo

```sh
cargo run --example react_demo
```

Open <http://127.0.0.1:3000>. The demo runs in the `dev` profile. In
`prod`, Autumn turns on CSRF, so an htmx `POST` needs the CSRF token.

## Development

```sh
cargo test                         # Rust tests, doc tests, demo smoke tests
npm ci && npm test                 # loader tests: real React 19, Chromium
npm run test:coverage              # the same, with loader line coverage
npm run typecheck                  # autumn-react.d.ts
cargo build --example react_demo && npm run test:e2e
npm run build:islands              # rebuild examples/islands/
```

See the
[plan](https://github.com/autumn-foundation/autumn-plugin-react/blob/main/docs/plan.md)
and
[ADR 0001](https://github.com/autumn-foundation/autumn-plugin-react/blob/main/docs/adr/0001-react-islands.md).

## License

Apache-2.0. The demo bundle in `examples/islands/` contains React
(MIT). It is not in the published crate.
