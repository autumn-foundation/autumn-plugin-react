//! [`PropsUpdate`]: new island props from the server, without a remount.

use std::convert::Infallible;

use autumn_web::reexports::axum::response::{IntoResponseParts, ResponseParts};
use autumn_web::reexports::http::{HeaderName, HeaderValue};
use serde::Serialize;

use crate::island::{PropsError, props_json};

/// The DOM event that the loader reads new props from.
pub const PROPS_EVENT: &str = "autumn:react:props";

const HX_TRIGGER: HeaderName = HeaderName::from_static("hx-trigger");

/// New props for mounted islands, sent in an `HX-Trigger` header.
///
/// htmx sends the [`PROPS_EVENT`] event. The loader sets `data-react-props`
/// on each target island. React renders the same root again, so the
/// component keeps its state.
///
/// ```rust
/// use autumn_plugin_react::PropsUpdate;
/// use autumn_web::prelude::*;
///
/// #[post("/cart")]
/// async fn add_to_cart() -> AutumnResult<(PropsUpdate, Markup)> {
///     let update = PropsUpdate::new().set("#cart", &serde_json::json!({ "count": 3 }))?;
///     Ok((update, html! { p { "Added." } }))
/// }
/// ```
///
/// The type sets the full `HX-Trigger` header. To send other events in the
/// same response, merge them into [`to_header_value`](Self::to_header_value)
/// yourself. An empty update sends no header.
#[derive(Debug, Clone, Default)]
#[must_use]
pub struct PropsUpdate {
    /// `(selector, props JSON)` pairs, in call order.
    entries: Vec<(String, String)>,
}

impl PropsUpdate {
    /// Makes an empty update.
    pub const fn new() -> Self {
        Self {
            entries: Vec::new(),
        }
    }

    /// Adds new props for the island at the CSS `selector`.
    ///
    /// # Errors
    ///
    /// The same errors as [`Island::props`](crate::Island::props).
    pub fn set<T: Serialize + ?Sized>(
        mut self,
        selector: impl Into<String>,
        props: &T,
    ) -> Result<Self, PropsError> {
        self.entries.push((selector.into(), props_json(props)?));
        Ok(self)
    }

    /// The number of updates.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// `true` when the update has no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The `HX-Trigger` header value:
    /// `{"autumn:react:props":[{"target":"#cart","props":{…}}]}`.
    ///
    /// The text is visible ASCII. Other characters become `\uXXXX`
    /// escapes, because a header value cannot hold them.
    #[must_use]
    pub fn to_header_value(&self) -> String {
        let mut json = format!("{{\"{PROPS_EVENT}\":[");
        for (i, (selector, props)) in self.entries.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            let target = serde_json::Value::String(selector.clone());
            json.push_str(&format!("{{\"target\":{target},\"props\":{props}}}"));
        }
        json.push_str("]}");
        ascii_json(&json)
    }
}

/// Escapes each character outside visible ASCII as `\uXXXX`.
///
/// Such characters occur only inside JSON strings, so the result is the
/// same JSON value.
fn ascii_json(json: &str) -> String {
    let mut out = String::with_capacity(json.len());
    for c in json.chars() {
        if (' '..='~').contains(&c) {
            out.push(c);
        } else {
            for unit in c.encode_utf16(&mut [0; 2]) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

impl IntoResponseParts for PropsUpdate {
    type Error = Infallible;

    fn into_response_parts(self, mut res: ResponseParts) -> Result<ResponseParts, Self::Error> {
        if !self.is_empty() {
            // `ascii_json` makes the value valid. `from_str` cannot fail.
            if let Ok(value) = HeaderValue::from_str(&self.to_header_value()) {
                res.headers_mut().insert(HX_TRIGGER, value);
            }
        }
        Ok(res)
    }
}
