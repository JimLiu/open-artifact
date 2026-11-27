//! Reads of connected tables: one table's call digest, how fresh its snapshot is, its rows and the references to its
//! columns (`readConnectedTable`), and the snapshots whose table file the page is yet to stream
//! (`readSnapshotsNotHeld`).

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::workbook::connected::{self, digest};
use crate::workbook::Workbook;

pub const KINDS: &[&str] = &["readConnectedTable", "readSnapshotsNotHeld"];

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    #[serde(rename_all = "camelCase")]
    ReadConnectedTable { sheet_id: String },
    ReadSnapshotsNotHeld {},
}

pub fn answer(workbook: &Workbook, request: &Json) -> String {
    match serde_json::from_value(request.clone()) {
        Ok(Request::ReadConnectedTable { sheet_id }) => {
            let sheet = workbook.sheet_index(&sheet_id).map(|i| &workbook.sheets[i]);
            let Some((sheet, table)) = sheet.and_then(|s| Some((s, s.connected.table.as_ref()?))) else {
                return r#"{"kind":"refused","refusal":"notAConnectedTable"}"#.to_owned();
            };
            let call_digest = digest::of_call(&table.call);
            let freshness = match &sheet.connected.snapshot {
                None => "notFetched",
                Some(s) if s.call_digest == call_digest => "current",
                Some(_) => "stale",
            };
            let references: Vec<Json> = sheet
                .columns
                .lines()
                .iter()
                .filter_map(|c| {
                    let column = sheet.connected.columns.get(c)?;
                    Some(json!({"c": workbook.bases.text(*c), "text": connected::column_reference_text(&sheet.name, &column.name)}))
                })
                .collect();
            json!({
                "kind": "connectedTable",
                "freshness": freshness,
                "callDigest": call_digest,
                "rows": connected::rows_contents(workbook, sheet),
                "references": references,
            })
            .to_string()
        }
        Ok(Request::ReadSnapshotsNotHeld {}) => {
            json!({"kind": "snapshotsNotHeld", "snapshotIds": workbook.snapshots_not_held()}).to_string()
        }
        Err(_) => super::unreadable(),
    }
}
