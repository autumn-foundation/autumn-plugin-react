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
/// The plugin name includes the bundle namespaces, for example
/// `autumn-plugin-react[app-islands]`. Thus a library crate and the app can
/// each install a `ReactPlugin` with their own bundles. Autumn skips a second
/// plugin with the same name.
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

impl Plugin for ReactPlugin {
    fn name(&self) -> Cow<'static, str> {
        if self.bundles.is_empty() {
            return Cow::Borrowed(PLUGIN_NAME);
        }
        let mut namespaces: Vec<&str> = self.bundles.iter().map(|b| b.namespace()).collect();
        namespaces.sort_unstable();
        namespaces.dedup();
        Cow::Owned(format!("{PLUGIN_NAME}[{}]", namespaces.join(",")))
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
