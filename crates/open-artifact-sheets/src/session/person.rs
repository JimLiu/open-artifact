//! Who makes the page's edits (`receivePerson`): the workbook's owner, someone not named, or a
//! person by user id. The page tells it as `{kind: "receivePerson", person}`; a person of no such kind, a user id not
//! well formed or a key more makes the request unreadable. The answer is the sync state, nothing changed.
//!
//! Protections are held against the person told: until one is, edits are made as the owner's.

use serde::{Deserialize, Deserializer};

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Person {
    // As struct variants, so that a key more is refused.
    Owner {},
    Unnamed {},
    #[serde(rename_all = "camelCase")]
    User {
        #[serde(deserialize_with = "user_id")]
        user_id: String,
    },
}

fn user_id<'de, D: Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    let id = String::deserialize(d)?;
    if !crate::workbook::rich::is_user_id(&id) {
        return Err(serde::de::Error::custom("a user id not well formed"));
    }
    Ok(id)
}

impl Person {
    /// Whether a protection with these editors is held against the person: anyone but the owner who is not among them,
    /// and always someone not named. With no person told, none is.
    pub fn is_kept_out(person: Option<&Person>, editors: &[String]) -> bool {
        match person {
            None | Some(Person::Owner {}) => false,
            Some(Person::Unnamed {}) => true,
            Some(Person::User { user_id }) => !editors.contains(user_id),
        }
    }
}
