//! [`ReactPlugin`]: installs the loader and the app bundles.

use std::borrow::Cow;

use autumn_web::app::AppBuilder;
use autumn_web::assets::PluginAssets;
use autumn_web::plugin::Plugin;
use autumn_web::plugin_contract::PluginContract;

use crate::assets::REACT_ASSETS;

/// The crate name. [`ReactPlugin`] with no app bundles uses it as its
/// plugin name. Each [`ReactPlugin`] declares it in its contract.
pub const PLUGIN_NAME: &str = env!("CARGO_PKG_NAME");

/// Installs React islands in an Autumn app.
///
/// It serves the loader ([`REACT_ASSETS`]) and each app bundle under
/// `/static/_plugins/<namespace>/`. It reads no configuration.
///
/// ```rust,no_run
/// use autumn_plugin_react::ReactPlugin;
/// use autumn_web::assets::PluginAssets;
///
/// static ISLANDS: PluginAssets =
///     PluginAssets::from_files("app-islands", &[("islands.js", b"/* build */")]);
///
/// # async fn run() {
/// autumn_web::app()
///     .plugin(ReactPlugin::new().bundle(&ISLANDS))
///     .run()
///     .await;
/// # }
/// ```
///
/// The plugin name includes each bundle namespace and a fingerprint of its
/// files, for example `autumn-plugin-react[app-islands@1a2b3c4d]`. Thus a
/// library crate and the app can each install a `ReactPlugin` with their
/// own bundles. Autumn skips a second plugin with the same bundles. Two
/// different bundles with one namespace stop the app at start-up.
#[derive(Debug, Default)]
#[must_use]
pub struct ReactPlugin {
    bundles: Vec<&'static PluginAssets>,
}

impl ReactPlugin {
    /// Makes the plugin with no app bundles.
    pub const fn new() -> Self {
        Self {
            bundles: Vec::new(),
        }
    }

    /// Adds an app bundle of compiled React components.
    ///
    /// The plugin uses a bundle one time, also when you add it two times.
    ///
    /// # Panics
    ///
    /// Panics when the bundle namespace is `react`. The loader bundle uses
    /// it. Autumn also stops at start-up when two different bundles use one
    /// namespace.
    pub fn bundle(mut self, bundle: &'static PluginAssets) -> Self {
        assert!(
            bundle.namespace() != REACT_ASSETS.namespace(),
            "the namespace `react` belongs to {PLUGIN_NAME}; give the app bundle another namespace"
        );
        if !self.bundles.iter().any(|b| std::ptr::eq(*b, bundle)) {
            self.bundles.push(bundle);
        }
        self
    }
}

/// `namespace@fingerprint`. The fingerprint is FNV-1a (32 bit) over the
/// hashed URLs of the files, so it changes when any file changes.
fn bundle_id(bundle: &PluginAssets) -> String {
    let mut hash: u32 = 0x811c_9dc5;
    for asset in bundle.iter() {
        for byte in asset.url().bytes().chain([0]) {
            hash ^= u32::from(byte);
            hash = hash.wrapping_mul(0x0100_0193);
        }
    }
    format!("{}@{hash:08x}", bundle.namespace())
}

impl Plugin for ReactPlugin {
    fn name(&self) -> Cow<'static, str> {
        if self.bundles.is_empty() {
            return Cow::Borrowed(PLUGIN_NAME);
        }
        let mut ids: Vec<String> = self.bundles.iter().map(|b| bundle_id(b)).collect();
        ids.sort_unstable();
        ids.dedup();
        Cow::Owned(format!("{PLUGIN_NAME}[{}]", ids.join(",")))
    }

    fn contract(&self) -> Option<PluginContract> {
        Some(
            PluginContract::new(PLUGIN_NAME)
                .plugin_version(env!("CARGO_PKG_VERSION"))
                .autumn_web("0.8"),
        )
    }

    fn build(self, app: AppBuilder) -> AppBuilder {
        self.bundles
            .into_iter()
            .fold(app.plugin_assets(&REACT_ASSETS), AppBuilder::plugin_assets)
    }
}
