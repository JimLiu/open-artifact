//! open-artifact-sheets: the engine behind the Sheets artifact type. One workbook per session: its sheets, rows,
//! columns and cells (all named by id), the operations that change it, and its formulas worked out.
//!
//! Everything crosses as JSON text (see `wasm.rs`, for wasm32): [`WorkbookSession::answer_json`] answers a request
//! about the session's workbook, [`answer_utility_request_json`] one that needs no workbook, and
//! [`functions::description::descriptions_json`] lists the functions a formula may call.

pub mod brought;
pub mod calculate;
pub mod coerce;
pub mod column_readings;
pub mod copied_cells;
pub mod criteria;
pub mod dates;
pub mod edited;
pub mod evaluate;
pub mod formula;
pub mod formula_text;
pub mod functions;
pub mod ids;
pub mod locale;
pub mod number_format;
pub mod session;
pub mod shown;
pub mod time_zone;
pub(crate) mod told;
pub mod typed_day;
pub mod typed_text;
pub mod typing;
pub mod utility;
pub mod value;
pub mod workbook;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use session::WorkbookSession;
pub use utility::answer_utility_request_json;

/// The clock the engine measures its own work by, in milliseconds (the page's `performance.now()`).
pub trait Clock {
    fn now_ms(&self) -> f64;
}

/// A clock for tests and native use.
pub struct SystemClock(std::time::Instant);

impl Default for SystemClock {
    fn default() -> Self {
        SystemClock(std::time::Instant::now())
    }
}

impl Clock for SystemClock {
    fn now_ms(&self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1000.0
    }
}
