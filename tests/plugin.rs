//! `ReactPlugin` serves the loader and app bundles through `plugin_assets`.

#![allow(clippy::expect_used, clippy::panic)]

use autumn_plugin_react::{ASSETS_NAMESPACE, LOADER_JS, PLUGIN_NAME, REACT_ASSETS, ReactPlugin};
use autumn_web::assets::{PLUGIN_ASSETS_ROUTE_MARKER, PluginAsset, PluginAssets, asset_url};
use autumn_web::plugin::Plugin as _;
use autumn_web::plugin_conformance::{ConformanceConfig, run_conformance};
use autumn_web::route_listing::{RouteClassification, RouteSource};
use autumn_web::test::{TestApp, TestClient};
use base64::Engine as _;
use sha2::{Digest as _, Sha384};

const JS: &str = "text/javascript; charset=utf-8";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const REVALIDATE: &str = "public, max-age=0, must-revalidate";
const PLAIN: &str = "/static/_plugins/react/react-islands.js";

static APP: PluginAssets = PluginAssets::from_files(
    "react-plugin-test",
    &[("islands.js", b"window.app = 1;"), ("islands.css", b".a{}")],
);

static OTHER: PluginAssets =
    PluginAssets::from_files("react-plugin-other", &[("islands.js", b"window.other = 1;")]);

fn client() -> TestClient {
    TestApp::new().plugin(ReactPlugin::new().bundle(&APP)).build()
}

fn sri(bytes: &[u8]) -> String {
    format!(
        "sha384-{}",
        base64::engine::general_purpose::STANDARD.encode(Sha384::digest(bytes))
    )
}

#[test]
fn loader_bundle_holds_only_the_loader() {
    let files: Vec<&str> = REACT_ASSETS.iter().map(PluginAsset::logical_path).collect();
    assert_eq!(files, [LOADER_JS]);
    assert_eq!(LOADER_JS, "react-islands.js");
    assert_eq!(ASSETS_NAMESPACE, "react");
    assert_eq!(REACT_ASSETS.namespace(), ASSETS_NAMESPACE);
    assert_eq!(REACT_ASSETS.mount_path(), "/static/_plugins/react");
}

#[test]
fn loader_is_the_file_on_disk_with_its_sri() {
    let asset = REACT_ASSETS.get(LOADER_JS).expect("bundled");
    assert_eq!(asset.bytes(), include_bytes!("../assets/react-islands.js"));
    assert_eq!(asset.integrity(), sri(asset.bytes()));
    assert_eq!(asset.content_type(), JS);
    assert_eq!(asset.plain_url(), PLAIN);
}

#[test]
fn loader_url_is_fingerprinted() {
    let url = REACT_ASSETS.url(LOADER_JS);
    let hash = url
        .strip_prefix("/static/_plugins/react/react-islands.")
        .and_then(|rest| rest.strip_suffix(".js"))
        .unwrap_or_else(|| panic!("{url} is fingerprinted"));
    assert_eq!(hash.len(), 8, "{url}");
    assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()), "{url}");
}

#[tokio::test]
async fn serves_the_loader_at_its_fingerprinted_url_immutable() {
    let response = client().get(&REACT_ASSETS.url(LOADER_JS)).send().await;
    response
        .assert_ok()
        .assert_header("content-type", JS)
        .assert_header("cache-control", IMMUTABLE);
    assert_eq!(
        response.body.as_slice(),
        include_bytes!("../assets/react-islands.js")
    );
}

#[tokio::test]
async fn serves_the_plain_url_with_revalidation_and_etag() {
    let client = client();
    let response = client.get(PLAIN).send().await;
    response
        .assert_ok()
        .assert_header("content-type", JS)
        .assert_header("cache-control", REVALIDATE);
    let etag = response.header("etag").expect("etag").to_owned();
    client
        .get(PLAIN)
        .header("if-none-match", &etag)
        .send()
        .await
        .assert_status(304);
}

#[tokio::test]
async fn serves_the_app_bundle_with_the_same_rules() {
    let client = client();
    for asset in APP.iter() {
        let response = client.get(asset.url()).send().await;
        response
            .assert_ok()
            .assert_header("cache-control", IMMUTABLE)
            .assert_header("content-type", asset.content_type());
        assert_eq!(response.body.as_slice(), asset.bytes());
        client
            .get(asset.plain_url())
            .send()
            .await
            .assert_ok()
            .assert_header("cache-control", REVALIDATE);
    }
}

#[tokio::test]
async fn unknown_and_stale_paths_are_not_found() {
    let client = client();
    for path in [
        "/static/_plugins/react/react-islands.00000000.js",
        "/static/_plugins/react/nope.js",
        "/static/_plugins/react/",
        "/static/_plugins/react-plugin-test/nope.js",
    ] {
        client.get(path).send().await.assert_status(404);
    }
}

#[tokio::test]
async fn asset_url_resolves_both_bundles() {
    let _client = client();
    assert_eq!(
        asset_url("_plugins/react/react-islands.js"),
        REACT_ASSETS.url(LOADER_JS)
    );
    assert_eq!(
        asset_url("_plugins/react-plugin-test/islands.js"),
        APP.url("islands.js")
    );
}

#[test]
fn routes_are_public_and_plugin_attributed() {
    let plugin = ReactPlugin::new().bundle(&APP);
    let name = plugin.name().into_owned();
    let app = autumn_web::app().plugin(plugin);
    let infos = app.plugin_route_infos().expect("route infos");
    let routes: Vec<_> = infos
        .iter()
        .filter(|info| info.path.starts_with("/static/_plugins/react"))
        .collect();
    // Loader: 1 file. App: 2 files. Two URLs for each file.
    assert_eq!(routes.len(), 6, "{infos:?}");
    for info in routes {
        assert_eq!(info.method, "GET");
        assert_eq!(info.classification, RouteClassification::Public);
        assert_eq!(info.middleware, [PLUGIN_ASSETS_ROUTE_MARKER]);
        assert_eq!(info.source, RouteSource::Plugin(name.clone()));
    }
}

#[test]
fn plugin_passes_conformance() {
    for plugin in [ReactPlugin::new(), ReactPlugin::new().bundle(&APP)] {
        let name = plugin.name().into_owned();
        let app = autumn_web::app().plugin(plugin);
        let infos = app.plugin_route_infos().expect("route infos");
        let report = run_conformance(&ConformanceConfig::new(&name), &infos);
        assert!(report.passed(), "{}", report.to_text_report());
    }
}

#[test]
fn plugin_declares_an_autumn_web_0_8_contract() {
    let contract = ReactPlugin::new().contract().expect("contract");
    assert_eq!(contract.plugin, PLUGIN_NAME);
    assert_eq!(PLUGIN_NAME, "autumn-plugin-react");
    assert_eq!(
        contract.plugin_version.as_deref(),
        Some(env!("CARGO_PKG_VERSION"))
    );
    assert_eq!(contract.autumn_web.as_deref(), Some("0.8"));
    assert!(contract.experimental_surfaces.is_empty());
    let app = autumn_web::app().plugin(ReactPlugin::new());
    assert_eq!(app.plugin_contracts().len(), 1);
}

#[test]
fn name_lists_the_bundle_namespaces() {
    assert_eq!(ReactPlugin::new().name(), PLUGIN_NAME);
    assert_eq!(
        ReactPlugin::new()
            .bundle(&OTHER)
            .bundle(&APP)
            .bundle(&APP)
            .name(),
        "autumn-plugin-react[react-plugin-other,react-plugin-test]"
    );
}

#[tokio::test]
async fn installing_twice_is_harmless() {
    let client = TestApp::new()
        .plugin(ReactPlugin::new().bundle(&APP))
        .plugin(ReactPlugin::new().bundle(&APP))
        .plugin(ReactPlugin::new())
        .build();
    client
        .get(&REACT_ASSETS.url(LOADER_JS))
        .send()
        .await
        .assert_ok();
    client.get(&APP.url("islands.js")).send().await.assert_ok();
}

#[tokio::test]
async fn two_plugins_with_different_bundles_both_serve() {
    let client = TestApp::new()
        .plugin(ReactPlugin::new().bundle(&APP))
        .plugin(ReactPlugin::new().bundle(&OTHER))
        .build();
    client.get(&APP.url("islands.js")).send().await.assert_ok();
    client.get(&OTHER.url("islands.js")).send().await.assert_ok();
    client
        .get(&REACT_ASSETS.url(LOADER_JS))
        .send()
        .await
        .assert_ok();
}

#[test]
#[should_panic(expected = "the namespace `react` belongs to autumn-plugin-react")]
fn an_app_bundle_in_the_loader_namespace_is_refused() {
    static CLASH: PluginAssets = PluginAssets::from_files("react", &[("x.js", b"")]);
    let _ = ReactPlugin::new().bundle(&CLASH);
}

#[test]
fn plugin_is_default_and_debug() {
    let plugin = ReactPlugin::default().bundle(&APP);
    let text = format!("{plugin:?}");
    assert!(text.contains("ReactPlugin"), "{text}");
    assert_eq!(ReactPlugin::default().name(), ReactPlugin::new().name());
}
