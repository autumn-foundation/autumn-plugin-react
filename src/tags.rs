//! Tag helpers for the page `<head>`.

use autumn_web::assets::{PluginAsset, PluginAssets};
use maud::Markup;

use crate::assets::{LOADER_JS, REACT_ASSETS};

/// Renders the `<script defer>` tag of the island loader.
///
/// The tag has the hashed URL, `integrity` and `crossorigin="anonymous"`.
/// Put it in the `<head>`.
///
/// ```rust
/// let html = autumn_plugin_react::react_script().into_string();
/// assert!(html.contains("/static/_plugins/react/react-islands."), "{html}");
/// assert!(html.contains(" defer"), "{html}");
/// ```
#[must_use]
pub fn react_script() -> Markup {
    REACT_ASSETS.deferred_script_tag(LOADER_JS)
}

/// Renders the tags of an app bundle, in this order:
///
/// 1. `<link rel="stylesheet">` for each `.css` file.
/// 2. `<script defer>` for each `.js` file (a classic script, esbuild
///    `--format=iife`).
/// 3. `<script type="module">` for each `.mjs` file (an ES module).
///
/// Files in a group are in logical-path order. Other files (fonts, source
/// maps) get no tag. Each tag has the hashed URL and `integrity`.
///
/// Each `.js` and `.mjs` file gets a tag. Thus, do not split the build into
/// chunks.
#[must_use]
pub fn react_bundle(bundle: &PluginAssets) -> Markup {
    let files = |ext: &'static str| {
        bundle
            .iter()
            .filter(move |asset| asset.logical_path().ends_with(ext))
    };
    maud::html! {
        @for asset in files(".css") { (bundle.stylesheet_tag(asset.logical_path())) }
        @for asset in files(".js") { (bundle.deferred_script_tag(asset.logical_path())) }
        @for asset in files(".mjs") { (module_tag(asset)) }
    }
}

fn module_tag(asset: &PluginAsset) -> Markup {
    maud::html! {
        script type="module" src=(asset.url()) integrity=(asset.integrity())
            crossorigin="anonymous" {}
    }
}
