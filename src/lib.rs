//! React islands for Autumn apps: React 19 components inside Maud + htmx
//! pages.
//!
//! 1. Build your components with a bundler. The entry file registers them
//!    (the README has a version that also checks the global):
//!
//!    ```js
//!    import { createElement, version } from "react";
//!    import { flushSync } from "react-dom";
//!    import { createRoot } from "react-dom/client";
//!    import { Counter } from "./Counter.jsx";
//!
//!    (window.autumnReact ??= []).push({
//!      createElement, createRoot, flushSync, version, components: { Counter },
//!    });
//!    ```
//!
//! 2. Embed the build output as a `PluginAssets` bundle and install it:
//!
//! ```rust,no_run
//! use autumn_plugin_react::{Island, ReactPlugin, react_bundle, react_script};
//! use autumn_web::assets::PluginAssets;
//! use autumn_web::prelude::*;
//!
//! static ISLANDS: PluginAssets = PluginAssets::from_files(
//!     "app-islands",
//!     &[("islands.js", b"/* esbuild output */")],
//! );
//!
//! #[get("/")]
//! async fn index() -> AutumnResult<Markup> {
//!     let counter = Island::new("Counter")
//!         .props(&serde_json::json!({ "start": 3 }))?
//!         .fallback(html! { p { "Count: 3" } });
//!     Ok(html! {
//!         html {
//!             head { (react_script()) (react_bundle(&ISLANDS)) }
//!             body { (counter) }
//!         }
//!     })
//! }
//!
//! # async fn run() {
//! autumn_web::app()
//!     .plugin(ReactPlugin::new().bundle(&ISLANDS))
//!     .routes(routes![index])
//!     .run()
//!     .await;
//! # }
//! ```
//!
//! The loader (`react-islands.js`) mounts each island with `createRoot`. It
//! mounts islands that htmx swaps in and unmounts islands that htmx swaps
//! out. A `data-react-props` change renders the same root again, so React
//! keeps the state. It uses no inline script and no `eval`, so it works
//! under the default CSP (`script-src 'self'`).
//!
//! # Security
//!
//! The loader mounts each `data-react-island` element in the page. If your
//! app shows user HTML, the sanitizer must remove `data-react-*`, `hx-*`
//! and `data-hx-*` attributes. `data-react-ignore` alone is not sufficient:
//! an htmx out-of-band swap can move an element out of it. Do not spread
//! untrusted props onto DOM elements.

mod assets;
mod island;
mod plugin;
mod tags;
mod update;

pub use assets::{ASSETS_NAMESPACE, LOADER_JS, REACT_ASSETS};
pub use island::{AttrError, Island, JsonKind, MountWhen, PropsError};
pub use plugin::{PLUGIN_NAME, ReactPlugin};
pub use tags::{react_bundle, react_script};
pub use update::{PROPS_EVENT, PropsUpdate};
