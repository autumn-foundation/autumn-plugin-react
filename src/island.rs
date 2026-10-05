//! [`Island`]: the server side of one React island.

use maud::{Markup, Render};
use serde::Serialize;

/// When the loader mounts an island.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum MountWhen {
    /// Mount when the loader starts. This is the default.
    #[default]
    Load,
    /// Mount when the browser is idle (`requestIdleCallback`).
    Idle,
    /// Mount when the island comes into the viewport.
    Visible,
}

impl MountWhen {
    /// The `data-react-mount` value. `None` for [`MountWhen::Load`].
    const fn attr(self) -> Option<&'static str> {
        match self {
            Self::Load => None,
            Self::Idle => Some("idle"),
            Self::Visible => Some("visible"),
        }
    }
}

/// The kind of a JSON value that is not an object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[non_exhaustive]
pub enum JsonKind {
    /// `null`.
    Null,
    /// `true` or `false`.
    Boolean,
    /// A number.
    Number,
    /// A string.
    String,
    /// An array.
    Array,
}

impl std::fmt::Display for JsonKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Null => "null",
            Self::Boolean => "a boolean",
            Self::Number => "a number",
            Self::String => "a string",
            Self::Array => "an array",
        })
    }
}

/// The error from [`Island::props`].
///
/// It converts to `AutumnError` (status 500), so `?` works in a handler.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum PropsError {
    /// The value does not serialize to JSON.
    #[error("island props do not serialize to JSON: {0}")]
    Serialize(#[from] serde_json::Error),
    /// The value is JSON, but not a JSON object.
    #[error("island props must be a JSON object, not {0}")]
    NotAnObject(JsonKind),
}

/// One React island: an element that the loader mounts a component into.
///
/// It renders as:
///
/// ```html
/// <div data-react-island="Counter" data-react-props="{...}"
///      data-react-mount="visible" id="..." class="...">fallback</div>
/// ```
///
/// The loader replaces the fallback with the component. Without JavaScript,
/// or after an error, the fallback stays.
///
/// ```rust
/// use autumn_plugin_react::{Island, MountWhen};
/// use maud::{Render, html};
///
/// let island = Island::new("Counter")
///     .props(&serde_json::json!({ "start": 3 }))?
///     .mount_when(MountWhen::Visible)
///     .fallback(html! { p { "Count: 3" } });
/// let html = island.render().into_string();
/// assert!(html.starts_with(r#"<div data-react-island="Counter""#));
/// # Ok::<(), autumn_plugin_react::PropsError>(())
/// ```
///
/// Props go in an HTML attribute. Keep them small. The component name, the
/// `id` and the `class` are trusted input from your code.
#[derive(Debug, Clone)]
#[must_use]
pub struct Island {
    name: String,
    props: Option<String>,
    when: MountWhen,
    fallback: Option<Markup>,
    id: Option<String>,
    class: Option<String>,
}

impl Island {
    /// Makes an island for the component that an app bundle registers as
    /// `name`.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            props: None,
            when: MountWhen::Load,
            fallback: None,
            id: None,
            class: None,
        }
    }

    /// The component name.
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Sets the component props. The value must serialize to a JSON object.
    ///
    /// # Errors
    ///
    /// - [`PropsError::Serialize`] when `serde_json` cannot serialize the
    ///   value (for example, a map with non-string keys).
    /// - [`PropsError::NotAnObject`] when the JSON is not an object.
    pub fn props<T: Serialize + ?Sized>(mut self, props: &T) -> Result<Self, PropsError> {
        self.props = Some(props_json(props)?);
        Ok(self)
    }

    /// Sets when the loader mounts the island. The default is
    /// [`MountWhen::Load`].
    pub const fn mount_when(mut self, when: MountWhen) -> Self {
        self.when = when;
        self
    }

    /// Sets the content to show before the mount, without JavaScript, and
    /// after an error.
    pub fn fallback(mut self, fallback: Markup) -> Self {
        self.fallback = Some(fallback);
        self
    }

    /// Sets the `id` attribute.
    pub fn id(mut self, id: impl Into<String>) -> Self {
        self.id = Some(id.into());
        self
    }

    /// Sets the `class` attribute.
    pub fn class(mut self, class: impl Into<String>) -> Self {
        self.class = Some(class.into());
        self
    }
}

/// Serializes props to JSON text. The text must be a JSON object.
pub(crate) fn props_json<T: Serialize + ?Sized>(props: &T) -> Result<String, PropsError> {
    // Serialize one time and keep the field order. The first byte of JSON
    // text gives its kind.
    let json = serde_json::to_string(props)?;
    let kind = match json.as_bytes().first() {
        Some(b'{') => return Ok(json),
        Some(b'[') => JsonKind::Array,
        Some(b'"') => JsonKind::String,
        Some(b'n') => JsonKind::Null,
        Some(b't' | b'f') => JsonKind::Boolean,
        _ => JsonKind::Number,
    };
    Err(PropsError::NotAnObject(kind))
}

impl Render for Island {
    fn render(&self) -> Markup {
        maud::html! {
            div data-react-island=(self.name)
                data-react-props=[self.props.as_deref()]
                data-react-mount=[self.when.attr()]
                id=[self.id.as_deref()]
                class=[self.class.as_deref()] {
                @if let Some(fallback) = &self.fallback { (fallback) }
            }
        }
    }
}
