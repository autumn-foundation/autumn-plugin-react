//! `PropsUpdate` sends new island props in an `HX-Trigger` header.

#![allow(clippy::expect_used, clippy::panic)]

use autumn_plugin_react::{JsonKind, PROPS_EVENT, PropsError, PropsUpdate};
use autumn_web::prelude::*;
use autumn_web::test::TestApp;

#[test]
fn header_value_is_an_event_with_a_list_of_updates() {
    let update = PropsUpdate::new()
        .set("#cart", &serde_json::json!({ "count": 2 }))
        .expect("props")
        .set("#badge", &serde_json::json!({ "n": 1 }))
        .expect("props");
    assert_eq!(PROPS_EVENT, "autumn:react:props");
    assert_eq!(
        update.to_header_value(),
        r##"{"autumn:react:props":[{"target":"#cart","props":{"count":2}},{"target":"#badge","props":{"n":1}}]}"##
    );
    assert_eq!(update.len(), 2);
    assert!(!update.is_empty());
}

#[test]
fn header_value_is_visible_ascii() {
    let update = PropsUpdate::new()
        .set(
            "#é",
            &serde_json::json!({ "name": "Zoë 🍁", "nl": "a\nb", "del": "\u{7f}" }),
        )
        .expect("props");
    let value = update.to_header_value();
    assert!(value.bytes().all(|b| (0x20..0x7f).contains(&b)), "{value}");
    // The JSON still decodes to the same text.
    let back: serde_json::Value = serde_json::from_str(&value).expect("json");
    let first = &back["autumn:react:props"][0];
    assert_eq!(first["target"], "#é");
    assert_eq!(first["props"]["name"], "Zoë 🍁");
    assert_eq!(first["props"]["nl"], "a\nb");
    assert_eq!(first["props"]["del"], "\u{7f}");
}

#[test]
fn set_refuses_props_that_are_not_an_object() {
    let error = PropsUpdate::new().set("#x", &[1, 2]).expect_err("array");
    assert!(matches!(error, PropsError::NotAnObject(JsonKind::Array)));
}

#[test]
fn empty_update_is_empty() {
    let update = PropsUpdate::default();
    assert!(update.is_empty());
    assert_eq!(update.len(), 0);
    assert_eq!(update.to_header_value(), r#"{"autumn:react:props":[]}"#);
}

#[get("/bump")]
async fn bump() -> AutumnResult<(PropsUpdate, &'static str)> {
    let update =
        PropsUpdate::new().set("#cart", &serde_json::json!({ "count": 3, "who": "Zoë" }))?;
    Ok((update, "ok"))
}

#[get("/empty")]
async fn empty() -> (PropsUpdate, &'static str) {
    (PropsUpdate::new(), "ok")
}

#[tokio::test]
async fn a_handler_returns_the_update_as_a_response_part() {
    let client = TestApp::new().routes(routes![bump, empty]).build();
    let response = client.get("/bump").send().await;
    response.assert_ok();
    let header = response.header("hx-trigger").expect("HX-Trigger header");
    assert_eq!(
        header,
        r##"{"autumn:react:props":[{"target":"#cart","props":{"count":3,"who":"Zo\u00eb"}}]}"##
    );
    assert_eq!(response.text(), "ok");
    // An empty update sends no header.
    let response = client.get("/empty").send().await;
    response.assert_ok();
    assert!(response.header("hx-trigger").is_none());
}
