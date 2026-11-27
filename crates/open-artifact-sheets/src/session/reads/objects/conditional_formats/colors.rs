//! Colors in conditional formats the agent writes by address, read more loosely than colors anywhere else.
//!
//! Every object in an effect whose `kind` is `rgb` or `standard` is put in the one form that is read, before the
//! effect is: an `rgb` hex of three or six hex digits, in any case and with or without its `#`, is written as `#`
//! and six small letters or digits; a `standard` hue in any case is the hue it names, `grey` and the other names
//! below being one of the nine hues, and `white` and `black` an `rgb` color (any shade is dropped). Anything else
//! is left as it is, to be refused as before.

use serde_json::{json, Value as Json};

/// The names read as one of the nine hues, or as `white` or `black`, each with what it is read as.
const NAMES: [(&str, &str); 60] = [
    ("gray", "gray"),
    ("red", "red"),
    ("orange", "orange"),
    ("yellow", "yellow"),
    ("green", "green"),
    ("teal", "teal"),
    ("blue", "blue"),
    ("purple", "purple"),
    ("magenta", "magenta"),
    ("grey", "gray"),
    ("charcoal", "gray"),
    ("silver", "gray"),
    ("slate", "gray"),
    ("ruby", "red"),
    ("maroon", "red"),
    ("salmon", "red"),
    ("coral", "red"),
    ("burgundy", "red"),
    ("crimson", "red"),
    ("scarlet", "red"),
    ("rust", "orange"),
    ("bronze", "orange"),
    ("copper", "orange"),
    ("apricot", "orange"),
    ("brown", "orange"),
    ("peach", "orange"),
    ("tangerine", "orange"),
    ("tan", "orange"),
    ("gold", "yellow"),
    ("sand", "yellow"),
    ("amber", "yellow"),
    ("beige", "yellow"),
    ("cream", "yellow"),
    ("khaki", "yellow"),
    ("lemon", "yellow"),
    ("mustard", "yellow"),
    ("lime", "green"),
    ("mint", "green"),
    ("sage", "green"),
    ("forest", "green"),
    ("olive", "green"),
    ("emerald", "green"),
    ("aqua", "teal"),
    ("cyan", "teal"),
    ("turquoise", "teal"),
    ("aquamarine", "teal"),
    ("navy", "blue"),
    ("cobalt", "blue"),
    ("azure", "blue"),
    ("sky", "blue"),
    ("plum", "purple"),
    ("indigo", "purple"),
    ("violet", "purple"),
    ("lavender", "purple"),
    ("mauve", "purple"),
    ("pink", "magenta"),
    ("rose", "magenta"),
    ("fuchsia", "magenta"),
    ("white", "#ffffff"),
    ("black", "#000000"),
];

/// Puts every color in a value (an effect, at any depth) in the form that is read.
pub(super) fn loosened(value: &mut Json) {
    match value {
        Json::Array(items) => items.iter_mut().for_each(loosened),
        Json::Object(object) => {
            match object.get("kind").and_then(Json::as_str) {
                Some("rgb") => {
                    if let Some(hex) = object.get("hex").and_then(Json::as_str).and_then(six_digits) {
                        object.insert("hex".into(), Json::String(hex));
                    }
                }
                Some("standard") => {
                    let named = object.get("hue").and_then(Json::as_str).and_then(|hue| {
                        let hue = hue.to_ascii_lowercase();
                        NAMES.iter().find(|(name, _)| *name == hue).map(|(_, read)| *read)
                    });
                    match named {
                        Some(hex) if hex.starts_with('#') => {
                            object.remove("hue");
                            object.remove("shade");
                            object.insert("kind".into(), json!("rgb"));
                            object.insert("hex".into(), json!(hex));
                        }
                        Some(hue) => {
                            object.insert("hue".into(), json!(hue));
                        }
                        None => {}
                    }
                }
                _ => {}
            }
            object.values_mut().for_each(loosened);
        }
        _ => {}
    }
}

/// A hex of three or six hex digits, with or without its `#`, as `#` and six small letters or digits.
fn six_digits(hex: &str) -> Option<String> {
    let digits = hex.strip_prefix('#').unwrap_or(hex);
    if !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let digits = digits.to_ascii_lowercase();
    match digits.len() {
        6 => Some(format!("#{digits}")),
        3 => Some(digits.chars().fold(String::from("#"), |mut s, c| {
            s.push(c);
            s.push(c);
            s
        })),
        _ => None,
    }
}
