//! Demo app for `autumn-plugin-react`.
//!
//! ```sh
//! cargo run --example react_demo
//! ```
//!
//! Then open <http://127.0.0.1:3000>. The page has five islands. The htmx
//! buttons add and remove islands, and send new props to the basket.
//!
//! The island bundle (`examples/islands/`) is the committed output of
//! `npm run build:islands`. You need no Node to run the demo.

use std::sync::Mutex;

use autumn_plugin_react::{
    Island, MountWhen, PropsUpdate, ReactPlugin, react_bundle, react_script,
};
use autumn_web::assets::{PluginAssets, asset_url};
use autumn_web::prelude::*;

/// The demo components, built from `frontend/`.
static ISLANDS: PluginAssets = PluginAssets::from_files(
    "react-demo",
    &[
        ("islands.js", include_bytes!("islands/islands.js")),
        ("islands.css", include_bytes!("islands/islands.css")),
    ],
);

/// The basket items. A real app keeps them in the session or a database.
static BASKET: Mutex<Vec<String>> = Mutex::new(Vec::new());

const PRODUCTS: [&str; 4] = ["Apples", "Pears", "Plums", "Quinces"];

#[autumn_web::main]
async fn main() {
    app().run().await;
}

fn app() -> autumn_web::app::AppBuilder {
    autumn_web::app()
        .plugin(ReactPlugin::new().bundle(&ISLANDS))
        .routes(routes![index, add_item, clock, empty])
}

fn layout(content: &Markup) -> Markup {
    html! {
        (maud::DOCTYPE)
        html lang="en" {
            head {
                meta charset="utf-8";
                meta name="viewport" content="width=device-width, initial-scale=1";
                title { "React islands demo" }
                script src=(asset_url("js/htmx.min.js")) defer {}
                (react_script())
                (react_bundle(&ISLANDS))
            }
            body { (content) }
        }
    }
}

fn basket_items() -> Vec<String> {
    BASKET.lock().map(|items| items.clone()).unwrap_or_default()
}

#[get("/")]
async fn index() -> AutumnResult<Markup> {
    let counter = Island::new("Counter")
        .id("counter")
        .props(&serde_json::json!({ "label": "Hits", "start": 3 }))?
        .fallback(html! { p { "Hits: 3" } });
    let basket = Island::new("Basket")
        .id("basket")
        .props(&serde_json::json!({ "items": basket_items() }))?
        .fallback(html! { p { "Basket" } });
    let broken = Island::new("Broken")
        .id("broken")
        .fallback(html! { p { "Server fallback: the component failed." } });
    let lazy = Island::new("Counter")
        .id("lazy")
        .mount_when(MountWhen::Visible)
        .props(&serde_json::json!({ "label": "Lazy" }))?
        .fallback(html! { p { "Lazy: waits until you scroll here." } });
    Ok(layout(&html! {
        h1 { "autumn-plugin-react" }
        section id="counter-section" {
            h2 { "Counter" }
            (counter)
        }
        section id="basket-section" {
            h2 { "Basket (props from the server)" }
            (basket)
            button id="add" hx-post="/basket" hx-swap="none" { "Add an item" }
        }
        section id="clock-section" {
            h2 { "Clock (htmx swaps)" }
            button id="show-clock" hx-get="/clock" hx-target="#clock-slot" { "Show clock" }
            " "
            button id="hide-clock" hx-get="/empty" hx-target="#clock-slot" { "Hide clock" }
            div id="clock-slot" {}
        }
        section id="broken-section" {
            h2 { "Error fallback" }
            (broken)
        }
        section id="lazy-section" {
            h2 { "Visible strategy" }
            @for i in 0..60 { p { "Line " (i) } }
            (lazy)
        }
    }))
}

#[post("/basket")]
async fn add_item() -> AutumnResult<(PropsUpdate, &'static str)> {
    let items = {
        let mut items = BASKET
            .lock()
            .map_err(|_| AutumnError::internal_server_error_msg("basket lock poisoned"))?;
        let next = PRODUCTS[items.len() % PRODUCTS.len()];
        items.push(next.to_owned());
        items.clone()
    };
    let update = PropsUpdate::new().set("#basket", &serde_json::json!({ "items": items }))?;
    Ok((update, ""))
}

#[get("/clock")]
async fn clock() -> AutumnResult<Markup> {
    let clock = Island::new("Clock")
        .id("clock")
        .props(&serde_json::json!({ "zone": "UTC" }))?
        .fallback(html! { "UTC clock" });
    Ok(html! { (clock) })
}

#[get("/empty")]
async fn empty() -> Markup {
    html! {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use autumn_plugin_react::{LOADER_JS, REACT_ASSETS};
    use autumn_web::test::TestApp;

    fn client() -> autumn_web::test::TestClient {
        TestApp::new()
            .plugin(ReactPlugin::new().bundle(&ISLANDS))
            .routes(routes![index, add_item, clock, empty])
            .build()
    }

    #[tokio::test]
    async fn index_has_the_tags_and_islands() {
        let client = client();
        let page = client.get("/").send().await;
        page.assert_ok();
        let html = page.text();
        assert!(html.contains(&REACT_ASSETS.url(LOADER_JS)), "{html}");
        assert!(html.contains(&ISLANDS.url("islands.js")), "{html}");
        assert!(html.contains(&ISLANDS.url("islands.css")), "{html}");
        for id in ["counter", "basket", "broken", "lazy"] {
            assert!(html.contains(&format!(r#"id="{id}""#)), "{id}: {html}");
        }
        client
            .get(&ISLANDS.url("islands.js"))
            .send()
            .await
            .assert_ok();
    }

    #[tokio::test]
    async fn fragments_render_islands() {
        let client = client();
        let clock = client.get("/clock").send().await;
        clock.assert_ok();
        assert!(clock.text().contains(r#"data-react-island="Clock""#));
        client.get("/empty").send().await.assert_ok();
    }

    #[test]
    fn app_builds() {
        let _ = app();
    }
}
