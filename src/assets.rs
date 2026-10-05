//! The loader bundle: `assets/react-islands.js`, embedded at compile time.
//!
//! [`ReactPlugin`](crate::ReactPlugin) installs [`REACT_ASSETS`] through
//! `AppBuilder::plugin_assets`. Autumn serves the file under
//! `/static/_plugins/react/`:
//!
//! - at a hashed URL (`react-islands.<sha256-prefix>.js`), `immutable`;
//! - at its plain URL (`react-islands.js`), `must-revalidate`;
//! - with `ETag`/`304`, `Range` and a computed `sha384` SRI hash.

use autumn_web::assets::PluginAssets;

/// URL namespace of the loader bundle: `/static/_plugins/react/`.
pub const ASSETS_NAMESPACE: &str = "react";

/// Logical path of the loader in [`REACT_ASSETS`].
pub const LOADER_JS: &str = "react-islands.js";

/// The loader bundle. It holds one file, [`LOADER_JS`].
///
/// [`ReactPlugin`](crate::ReactPlugin) installs it. Use it directly only to
/// make URLs or tags yourself:
///
/// ```rust
/// use autumn_plugin_react::{LOADER_JS, REACT_ASSETS};
///
/// let url = REACT_ASSETS.url(LOADER_JS);
/// assert!(url.starts_with("/static/_plugins/react/react-islands."), "{url}");
/// assert!(REACT_ASSETS.integrity(LOADER_JS).is_some_and(|s| s.starts_with("sha384-")));
/// ```
///
/// `PluginAssets::from_files` does not need the `embed-assets` feature, so
/// the host app does not need it either.
pub static REACT_ASSETS: PluginAssets = PluginAssets::from_files(
    ASSETS_NAMESPACE,
    &[(LOADER_JS, include_bytes!("../assets/react-islands.js"))],
);
