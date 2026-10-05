//! `react_script` and `react_bundle` render tags with SRI.

#![allow(clippy::expect_used, clippy::panic)]

use autumn_plugin_react::{LOADER_JS, REACT_ASSETS, react_bundle, react_script};
use autumn_web::assets::PluginAssets;

static APP: PluginAssets = PluginAssets::from_files(
    "react-tags-test",
    &[
        ("b.js", b"b"),
        ("a.js", b"a"),
        ("chunk.mjs", b"m"),
        ("style.css", b"s"),
        ("font.woff2", b"f"),
        ("a.js.map", b"{}"),
    ],
);

#[test]
fn loader_tag_is_deferred_with_sri() {
    let asset = REACT_ASSETS.get(LOADER_JS).expect("loader");
    assert_eq!(
        react_script().into_string(),
        format!(
            r#"<script src="{}" integrity="{}" crossorigin="anonymous" defer></script>"#,
            asset.url(),
            asset.integrity()
        )
    );
}

#[test]
fn bundle_tags_are_css_then_classic_js_then_modules() {
    let get = |path| APP.get(path).expect(path);
    let tag = |path| {
        let a = get(path);
        format!(
            r#"<script src="{}" integrity="{}" crossorigin="anonymous" defer></script>"#,
            a.url(),
            a.integrity()
        )
    };
    let css = get("style.css");
    let module = get("chunk.mjs");
    let expected = [
        format!(
            r#"<link rel="stylesheet" href="{}" integrity="{}" crossorigin="anonymous">"#,
            css.url(),
            css.integrity()
        ),
        tag("a.js"),
        tag("b.js"),
        format!(
            r#"<script type="module" src="{}" integrity="{}" crossorigin="anonymous"></script>"#,
            module.url(),
            module.integrity()
        ),
    ]
    .concat();
    assert_eq!(react_bundle(&APP).into_string(), expected);
}

#[test]
fn bundle_tags_skip_other_files() {
    let html = react_bundle(&APP).into_string();
    for skipped in ["font.", ".map"] {
        assert!(!html.contains(skipped), "{skipped}: {html}");
    }
}

#[test]
fn empty_bundle_renders_nothing() {
    static EMPTY: PluginAssets = PluginAssets::from_files("react-tags-empty", &[]);
    assert_eq!(react_bundle(&EMPTY).into_string(), "");
}
