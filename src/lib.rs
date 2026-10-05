//! React islands for Autumn apps: React components inside Maud + htmx pages.
//!
//! 1. Build your components with a bundler. The entry file registers them:
//!
//!    ```js
//!    import { createElement } from "react";
//!    import { createRoot } from "react-dom/client";
//!    import Counter from "./Counter.jsx";
//!
//!    let queue = window.autumnReact;
//!    if (!Array.isArray(queue) && queue?.loader !== true) {
//!      queue = window.autumnReact = [];
//!    }
//!    queue.push({ createElement, createRoot, components: { Counter } });
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
//! app shows user HTML, the sanitizer must remove `data-react-*`
//! attributes, or you must put that HTML in a `data-react-ignore` element.

mod assets;
mod island;
mod plugin;
mod tags;

pub use assets::{ASSETS_NAMESPACE, LOADER_JS, REACT_ASSETS};
pub use island::{Island, JsonKind, MountWhen, PropsError};
pub use plugin::{PLUGIN_NAME, ReactPlugin};
pub use tags::{react_bundle, react_script};
