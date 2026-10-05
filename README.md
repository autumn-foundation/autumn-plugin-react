# autumn-plugin-react

React islands for [Autumn](https://github.com/autumn-foundation/autumn)
0.8 apps. Put React components into Maud + htmx pages. No Node at run time.

- The plugin serves a small loader through the Autumn `plugin_assets`
  seam: hashed URLs, `immutable` cache, SRI.
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

## Use

### 1. Build the components

The entry file registers your components on `window.autumnReact`. The
loader can run before or after this file.

```jsx
// frontend/src/main.jsx
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Counter } from "./Counter.jsx";

let queue = window.autumnReact;
// An element with id="autumnReact" can clobber the global. Check it.
if (!Array.isArray(queue) && queue?.loader !== true) {
  queue = window.autumnReact = [];
}
queue.push({ createElement, createRoot, components: { Counter } });
```

Build one classic script (no chunks):

```sh
esbuild frontend/src/main.jsx --bundle --format=iife --minify \
  --jsx=automatic --define:process.env.NODE_ENV='"production"' \
  --outfile=islands/islands.js
```

`frontend/` in this repo is a complete reference project. Types for the
registration API are in `frontend/src/autumn-react.d.ts`.

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

`react_bundle` renders a `<link>` for each `.css` file, a `<script defer>`
for each `.js` file and a `<script type="module">` for each `.mjs` file.

### 3. Send new props from the server

```rust,ignore
use autumn_plugin_react::PropsUpdate;

#[post("/basket")]
async fn add_item() -> AutumnResult<(PropsUpdate, Markup)> {
    let update = PropsUpdate::new().set("#basket", &serde_json::json!({ "items": 3 }))?;
    Ok((update, html! {}))
}
```

`PropsUpdate` sets the `HX-Trigger` header. htmx sends the
`autumn:react:props` event. The loader sets `data-react-props` on the
island, and React renders the same root again. App code can send the same
event:

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
| `data-react-island` | `Island::new` | The registered component name. |
| `data-react-props` | `Island::props` | A JSON object. Change it to render again with new props. |
| `data-react-mount` | `Island::mount_when` | `idle` or `visible`. No attribute: mount at load. |
| `data-react-state` | the loader | `waiting`, `pending` (name not registered yet), `mounted` or `error`. |
| `data-react-ignore` | you | No island in this element mounts. |

The loader sends these events. They bubble. `detail` has `name` and
`element` (and `error` for `error`):

| Event | When |
| --- | --- |
| `autumn:react:mount` | A root is made and rendered. |
| `autumn:react:update` | New props are rendered. |
| `autumn:react:unmount` | The island left the page. Sent on `document`. |
| `autumn:react:error` | Bad props, a mount error or a render crash. |

## Behavior

- **Mount.** The loader moves the fallback out of the island, then calls
  `createRoot` with a unique `identifierPrefix`. There is no hydration:
  Rust cannot render React.
- **Errors.** Bad props or a failed mount keep the fallback. A render
  crash (React 19 `onUncaughtError`) puts the fallback back. Other islands
  are not affected.
- **htmx.** One `MutationObserver` mounts added islands and unmounts
  removed islands. An island that moves in one task keeps its root.
- **Props.** A `data-react-props` change renders the same root again. A
  `data-react-island` change mounts a new root.
- **Nesting.** An island inside another island does not mount. React owns
  the outer island's DOM.
- **Morphs.** Do not morph the children of a mounted island (idiomorph).
  Swap it with `outerHTML`, or send new props.

## Security

- The loader mounts each `data-react-island` element in the page. If your
  app shows user HTML, the sanitizer must remove `data-react-*`
  attributes, or you must put that HTML in a `data-react-ignore` element.
- Props are in an HTML attribute. Maud escapes them. The loader reads them
  with `JSON.parse`. Do not put secrets in props.
- Component names, `id`, `class` and `PropsUpdate` selectors are trusted
  input from your code.

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
cargo build --example react_demo && npm run test:e2e
npm run build:islands              # rebuild examples/islands/
```

See [docs/plan.md](docs/plan.md) and
[ADR 0001](docs/adr/0001-react-islands.md).

## License

Apache-2.0
