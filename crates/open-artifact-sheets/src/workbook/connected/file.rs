//! A table file: the rows a snapshot fetched, as the page streams them to the module (`receiveLinesOfTableFile`).
//!
//! The file is lines of JSON, each one object of one key. The first says what the table is:
//! `{"table": {"version": 1, "rowCount": n, "fields": [...], "narrowedTo": ...}}`. Then each field in turn has a line
//! of its distinct values (`{"values": [...]}`: null, numbers, texts, true or false; no more than there are rows, and
//! at least one when there are rows) and one or more lines of the places of its rows among them
//! (`{"places": [...]}`), as many places in all as there are rows. A file may come in several messages; each ends at
//! the end of a line, and one that opens with the first line starts the file again.

use serde::Deserialize;
use serde_json::Value as Json;

/// The longest text a value may be, in bytes.
const LONGEST_TEXT: usize = 32_767;

/// One value of a file.
#[derive(Clone, Debug, PartialEq)]
pub enum FileValue {
    Null,
    Number(f64),
    Text(String),
    Boolean(bool),
}

/// A table file read whole.
#[derive(Debug)]
pub struct TableFile {
    pub fields: Vec<String>,
    pub row_count: usize,
    /// The fields the server narrowed the file to (`narrowedTo`), when it did.
    pub narrowed_to: Option<Vec<String>>,
    columns: Vec<(Vec<FileValue>, Vec<u32>)>,
}

impl TableFile {
    /// The value of a field (by its place among the fields) in a row (0 is the first record).
    pub fn value(&self, field: usize, row: usize) -> &FileValue {
        let (values, places) = &self.columns[field];
        &values[places[row] as usize]
    }

    /// The bytes of the texts of a row, every field's.
    pub fn text_in_bytes_of_row(&self, row: usize) -> u64 {
        (0..self.fields.len())
            .map(|f| match self.value(f, row) {
                FileValue::Text(t) => t.len() as u64,
                _ => 0,
            })
            .sum()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Header {
    version: u32,
    row_count: u32,
    fields: Vec<String>,
    #[serde(default)]
    narrowed_to: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
enum Line {
    Table(Header),
    Values(Vec<Json>),
    Places(Vec<u32>),
}

/// A file being read, line by line.
#[derive(Debug, Default)]
pub struct Reading {
    header: Option<(usize, Vec<String>, Option<Vec<String>>)>,
    columns: Vec<(Vec<FileValue>, Vec<u32>)>,
    /// Whether the field being read has had its line of values.
    has_values: bool,
}

/// The file cannot be read.
#[derive(Debug)]
pub struct Unreadable;

impl Reading {
    /// Reads a message of lines: the file once the last message is read, nothing until then.
    pub fn read(&mut self, lines: &str, is_last: bool) -> Result<Option<TableFile>, Unreadable> {
        let mut pieces: Vec<&str> = lines.split('\n').collect();
        if pieces.last() == Some(&"") {
            pieces.pop();
        }
        // A message that opens with the line of what the table is starts the file again.
        if pieces.first().is_some_and(|line| matches!(serde_json::from_str(line), Ok(Line::Table(_)))) {
            *self = Reading::default();
        }
        for line in pieces {
            self.read_line(line)?;
        }
        if !is_last {
            return Ok(None);
        }
        if !self.is_whole() {
            return Err(Unreadable);
        }
        let (row_count, fields, narrowed_to) = self.header.take().ok_or(Unreadable)?;
        Ok(Some(TableFile { fields, row_count, narrowed_to, columns: std::mem::take(&mut self.columns) }))
    }

    fn is_whole(&self) -> bool {
        self.header.as_ref().is_some_and(|(_, fields, _)| self.columns.len() == fields.len() && !self.has_values)
    }

    fn read_line(&mut self, line: &str) -> Result<(), Unreadable> {
        let line: Line = serde_json::from_str(line).map_err(|_| Unreadable)?;
        let Some((row_count, fields, _)) = &self.header else {
            let Line::Table(header) = line else { return Err(Unreadable) };
            let mut seen = hashbrown::HashSet::new();
            let unique = header.fields.iter().all(|f| !f.is_empty() && seen.insert(f.as_str()));
            drop(seen);
            if header.version != 1 || !unique {
                return Err(Unreadable);
            }
            self.header = Some((header.row_count as usize, header.fields, header.narrowed_to));
            return Ok(());
        };
        let row_count = *row_count;
        if self.columns.len() == fields.len() && !self.has_values {
            return Err(Unreadable);
        }
        match line {
            Line::Table(_) => Err(Unreadable),
            Line::Values(values) => {
                if self.has_values || values.len() > row_count {
                    return Err(Unreadable);
                }
                let values = values.into_iter().map(file_value).collect::<Option<Vec<_>>>().ok_or(Unreadable)?;
                self.columns.push((values, Vec::new()));
                self.has_values = true;
                Ok(())
            }
            Line::Places(places) => {
                let Some((values, kept)) = self.columns.last_mut().filter(|_| self.has_values) else { return Err(Unreadable) };
                if kept.len() + places.len() > row_count || places.iter().any(|&p| p as usize >= values.len()) {
                    return Err(Unreadable);
                }
                kept.extend(places);
                if kept.len() == row_count {
                    self.has_values = false;
                }
                Ok(())
            }
        }
    }
}

fn file_value(value: Json) -> Option<FileValue> {
    Some(match value {
        Json::Null => FileValue::Null,
        Json::Bool(b) => FileValue::Boolean(b),
        Json::Number(n) => FileValue::Number(n.as_f64()?),
        Json::String(t) => {
            if t.len() > LONGEST_TEXT || t.chars().any(|c| c < ' ' && !matches!(c, '\t' | '\n' | '\r')) {
                return None;
            }
            FileValue::Text(t)
        }
        _ => return None,
    })
}
