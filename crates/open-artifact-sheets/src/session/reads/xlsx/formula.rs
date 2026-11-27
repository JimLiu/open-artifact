//! A formula as Excel reads it, written again from the expression the formula reads as.
//!
//! What is written:
//! - operators with only the parentheses their order needs; numbers, texts, errors and arrays as Excel spells them;
//! - functions newer than Excel 2007 with `_xlfn.` before them (`_xlfn._xlws.` for FILTER and SORT), and an argument
//!   Excel needs where ours may leave it out (`ROUND(1)` is `ROUND(1,0)`);
//! - a reference from where its cells are now, its sheet by its name in the file, whole columns from a row down to
//!   the sheet's end (`A2:B1048576`); one that has lost its cells is `#REF!`;
//! - LET's names as `_xlpm.NAME`, and a name nobody gives a value to as `#NAME?`; a LET whose arguments do not pair
//!   up is `#N/A`, and one that gives a value to what is not a name, or to a name twice, `#NAME?`, as they work out;
//! - FILTER's conditions after the first multiplied into one (`(A1:A5>1)*(B1:B5<4)`), as Excel takes one.
//!
//! What is not written (the cell holds its value instead): a formula that does not read, calls a function Excel
//! does not have (HYPERLINK, SPLIT, the REGEX ones, SORTN, a name nobody knows), calls one with too few or too many
//! arguments, holds #SPILL!, #ERROR! or #TIMEOUT!, gives a function a value where Excel takes only a reference
//! (`SUMIF({1,2},">0")`), or has a FILTER whose conditions Excel cannot take.
//!
//! A formula is written as an array formula (`t="array"`, the dynamic-array kind) when it calls LET or a function
//! that answers an array, gives several cells where one value is taken (an operator's operand, an argument that
//! takes one value), or may answer several cells itself (`=A1:A3`, `=IF(1,A1:A3)`).

mod lambda;

use std::fmt::Write;

use crate::formula::{column_letters, BinaryOp, Expr, Reference, StoredFormula, UnaryOp};
use crate::evaluate::lambda::Walk;
use crate::functions::{self, Answers, Takes};
use crate::value::{CellError, Value};
use crate::workbook::Workbook;

/// The last row and column Excel has.
pub(super) const LAST_ROW: usize = 1_048_576;
pub(super) const LAST_COLUMN: &str = "XFD";

/// Functions Excel has only with a prefix in the file.
const NEWER: &[&str] = &[
    "CONCAT", "DAYS", "HSTACK", "IFNA", "IFS", "ISOWEEKNUM", "LET", "MAXIFS", "MINIFS", "MODE.SNGL", "PERCENTILE.INC",
    "QUARTILE.INC", "RANK.EQ", "STDEV.P", "STDEV.S", "SWITCH", "TEXTJOIN", "UNICHAR", "UNICODE", "UNIQUE", "VAR.P",
    "VAR.S", "VSTACK", "XLOOKUP", "XMATCH", "XOR",
    // The newer functions.
    "BYCOL", "BYROW", "LAMBDA", "MAP", "NUMBERVALUE", "SEQUENCE", "TEXTSPLIT",
];

/// Functions Excel has only in its worksheet namespace.
const NEWER_IN_SHEETS: &[&str] = &["FILTER", "SORT"];

/// Functions Excel does not have: a formula that calls one is written as its value.
const NOT_IN_EXCEL: &[&str] = &["HYPERLINK", "REGEXEXTRACT", "REGEXMATCH", "REGEXREPLACE", "SORTN", "SPLIT"];

/// Arguments Excel takes only as references, by function and argument name.
const ONLY_REFERENCES: &[(&str, &[&str])] = &[
    ("AVERAGEIF", &["condition range", "average range"]),
    ("AVERAGEIFS", &["average range", "condition range"]),
    ("COLUMN", &["cell"]),
    ("COUNTBLANK", &["range"]),
    ("COUNTIF", &["condition range"]),
    ("COUNTIFS", &["condition range"]),
    ("MAXIFS", &["max range", "condition range"]),
    ("MINIFS", &["min range", "condition range"]),
    ("RANK", &["range"]),
    ("RANK.EQ", &["range"]),
    ("ROW", &["cell"]),
    ("SUBTOTAL", &["range"]),
    ("SUMIF", &["condition range", "sum range"]),
    ("SUMIFS", &["sum range", "condition range"]),
];

/// Functions whose answer may stand where Excel takes a reference.
const ANSWER_REFERENCES: &[&str] = &["CHOOSE", "IF", "INDEX", "XLOOKUP"];

/// A formula as written in the file.
pub struct Written {
    /// Its text, without `=`.
    pub text: String,
    pub is_array: bool,
}

/// The formula of a cell on `sheet` as Excel reads it; `None` when the cell is written as its value. `names` are
/// the sheets' names in the file, in the workbook's order.
pub fn write(
    workbook: &Workbook,
    sheet: usize,
    formula: &StoredFormula,
    expr: &Expr,
    names: &[String],
) -> Option<Written> {
    let mut writer = Writer { workbook, sheet, formula, names, scopes: Vec::new() };
    let written = writer.expr(expr)?;
    let is_array = calls_an_array(expr) || gives_several_where_one_is_taken(expr, formula, workbook) || is_several(expr, formula, workbook);
    Some(Written { text: written.text, is_array })
}

/// Whether a formula calls RAND or RANDBETWEEN.
pub fn draws_random_numbers(expr: &Expr) -> bool {
    any(expr, &|e| matches!(e, Expr::Call { function: Some(f), .. } if matches!(f.name(), "RAND" | "RANDBETWEEN")))
}

/// Whether any part of an expression is one `test` holds for (a LET written as its error has no parts).
fn any(expr: &Expr, test: &dyn Fn(&Expr) -> bool) -> bool {
    if let Expr::Call { function: Some(f), arguments, .. } = expr {
        if let_fault(*f, arguments).is_some() {
            return false;
        }
    }
    if test(expr) {
        return true;
    }
    match expr {
        Expr::Unary(_, x) => any(x, test),
        Expr::Binary(_, a, b) => any(a, test) || any(b, test),
        Expr::Call { arguments, .. } => arguments.iter().any(|a| any(a, test)),
        _ => false,
    }
}

/// The error a LET is written as, as it works out: #N/A when its arguments do not pair up, #NAME? when one it
/// gives a value to is not a name or is given one twice.
fn let_fault(f: functions::FunctionId, arguments: &[Expr]) -> Option<CellError> {
    if f.name() == "LAMBDA" {
        return lambda::fault(arguments);
    }
    if f.name() != "LET" {
        return None;
    }
    if functions::match_arguments(f.description(), arguments.len()).is_none() {
        return Some(CellError::NotAvailable);
    }
    let mut given: Vec<&str> = Vec::new();
    for i in 0..(arguments.len() - 1) / 2 {
        match &arguments[2 * i] {
            // A cell past the sheet's end is no name (`LET(cr1,1,cr1)` is `#NAME?`).
            Expr::Name(n) if !given.iter().any(|g| g.eq_ignore_ascii_case(n)) && !crate::formula::parse::looks_like_a_cell(n) => {
                given.push(n)
            }
            _ => return Some(CellError::Name),
        }
    }
    None
}

/// Whether a formula calls LET or a function that answers an array.
fn calls_an_array(expr: &Expr) -> bool {
    any(expr, &|e| match e {
        Expr::Call { function: Some(f), .. } => f.name() == "LET" || f.description().answers == Answers::AnArray,
        _ => false,
    })
}

/// Whether an expression may be several cells: a range, an array of more than one value, a function's array, or
/// one of its arguments as it came when that is. A named range is several unless it is one cell (its corners the
/// same) or removed.
fn is_several(expr: &Expr, formula: &StoredFormula, workbook: &Workbook) -> bool {
    match expr {
        Expr::Reference(i) => match &formula.references[*i] {
            Reference::Cell { .. } => false,
            Reference::NamedRange { named_range_id } => workbook
                .named_range(named_range_id)
                .is_some_and(|range| !matches!(range.cells.as_reference(), Reference::Cell { .. })),
            _ => true,
        },
        Expr::Array(a) => a.rows() * a.columns() > 1,
        Expr::Unary(_, x) => is_several(x, formula, workbook),
        Expr::Binary(_, a, b) => is_several(a, formula, workbook) || is_several(b, formula, workbook),
        Expr::Call { function: Some(f), arguments, .. } if let_fault(*f, arguments).is_none() => {
            match f.description().answers {
                Answers::AnArray => true,
                Answers::AnArgumentAsItCame => arguments.iter().any(|a| is_several(a, formula, workbook)),
                _ => false,
            }
        }
        _ => false,
    }
}

/// Whether an expression is several cells where one value is taken: an operator's operand, an argument that takes
/// one value, or the cells of ROW or COLUMN.
fn gives_several_where_one_is_taken(expr: &Expr, formula: &StoredFormula, workbook: &Workbook) -> bool {
    let several = |e: &Expr| is_several(e, formula, workbook);
    any(expr, &|e| match e {
        Expr::Unary(_, x) => several(x),
        Expr::Binary(_, a, b) => several(a) || several(b),
        Expr::Call { function: Some(f), arguments, .. } => {
            match functions::match_arguments(f.description(), arguments.len()) {
                // ROW and COLUMN of several cells answer one for each row or column in Excel.
                Some(slots) => arguments.iter().zip(slots).any(|(a, slot)| {
                    (slot.takes == Takes::OneValue || matches!(f.name(), "ROW" | "COLUMN")) && several(a)
                }),
                None => false,
            }
        }
        _ => false,
    })
}

/// How tightly a written expression holds together: an operand looser than its operator is put in parentheses.
#[derive(Clone, Copy, PartialEq, PartialOrd)]
enum Tightness {
    Comparison,
    Concat,
    Additive,
    Term,
    Power,
    Percent,
    Unary,
    Primary,
}

struct Text {
    text: String,
    tightness: Tightness,
}

impl Text {
    fn primary(text: String) -> Text {
        Text { text, tightness: Tightness::Primary }
    }

    /// The text, in parentheses when it is looser than `at_least`.
    fn at(self, at_least: Tightness) -> String {
        if self.tightness < at_least {
            format!("({})", self.text)
        } else {
            self.text
        }
    }
}

struct Writer<'a> {
    workbook: &'a Workbook,
    sheet: usize,
    formula: &'a StoredFormula,
    names: &'a [String],
    /// The names LET gives values to where the writer is.
    scopes: Vec<std::rc::Rc<str>>,
}

impl Writer<'_> {
    fn expr(&mut self, expr: &Expr) -> Option<Text> {
        Some(match expr {
            Expr::Number(n) => Text::primary(format!("{n}")),
            Expr::Text(s) => Text::primary(format!("\"{}\"", s.replace('"', "\"\""))),
            Expr::Boolean(b) => Text::primary(if *b { "TRUE" } else { "FALSE" }.to_owned()),
            Expr::Error(e) => Text::primary(error_text(*e)?.to_owned()),
            Expr::Reference(i) => Text::primary(self.reference(*i)),
            Expr::Name(name) => Text::primary(if self.scopes.contains(name) {
                lambda::parameter(name)
            } else {
                CellError::Name.text().to_owned()
            }),
            Expr::Missing => Text::primary(String::new()),
            Expr::Array(a) => {
                let mut out = String::from("{");
                for r in 0..a.rows() {
                    if r > 0 {
                        out.push(';');
                    }
                    for c in 0..a.columns() {
                        if c > 0 {
                            out.push(',');
                        }
                        out.push_str(&constant(a.get(r, c))?);
                    }
                }
                out.push('}');
                Text::primary(out)
            }
            Expr::Unary(UnaryOp::Percent, x) => {
                let x = self.expr(x)?.at(Tightness::Percent);
                Text { text: format!("{x}%"), tightness: Tightness::Percent }
            }
            Expr::Unary(op, x) => {
                let sign = if *op == UnaryOp::Negate { "-" } else { "+" };
                let x = self.expr(x)?.at(Tightness::Unary);
                Text { text: format!("{sign}{x}"), tightness: Tightness::Unary }
            }
            Expr::Binary(op, a, b) => {
                let (sign, tightness) = binary(*op);
                let a = self.expr(a)?.at(tightness);
                let b = self.expr(b)?;
                // Operators group from the left: an operand on the right as loose as the operator keeps its
                // parentheses.
                let b = if b.tightness <= tightness { format!("({})", b.text) } else { b.text };
                Text { text: format!("{a}{sign}{b}"), tightness }
            }
            Expr::Call { function: None, .. } => return None,
            Expr::Call { function: Some(f), arguments, .. } => return self.call(*f, arguments),
        })
    }

    fn call(&mut self, f: functions::FunctionId, arguments: &[Expr]) -> Option<Text> {
        let name = f.name();
        if NOT_IN_EXCEL.contains(&name) {
            return None;
        }
        if let Some(error) = let_fault(f, arguments) {
            return Some(Text::primary(error.text().to_owned()));
        }
        let slots = functions::match_arguments(f.description(), arguments.len())?;
        // ARRAYFORMULA is what an array formula is in Excel: its argument is written alone (and the formula as an
        // array, `calls_an_array`).
        if name == "ARRAYFORMULA" {
            return self.expr(&arguments[0]);
        }
        if let Some((_, only)) = ONLY_REFERENCES.iter().find(|(n, _)| *n == name) {
            let gives_a_reference = |a: &Expr| match a {
                Expr::Reference(_) => true,
                Expr::Call { function: Some(g), .. } => ANSWER_REFERENCES.contains(&g.name()),
                _ => false,
            };
            if arguments.iter().zip(&slots).any(|(a, slot)| only.contains(&slot.name) && !gives_a_reference(a)) {
                return None;
            }
        }
        let mut written: Vec<String> = Vec::with_capacity(arguments.len() + 1);
        match name {
            "LET" => {
                let depth = self.scopes.len();
                let pairs = (arguments.len() - 1) / 2;
                for i in 0..pairs {
                    let Expr::Name(n) = &arguments[2 * i] else {
                        self.scopes.truncate(depth);
                        return None;
                    };
                    let value = self.expr(&arguments[2 * i + 1]);
                    let Some(value) = value else {
                        self.scopes.truncate(depth);
                        return None;
                    };
                    written.push(lambda::parameter(n));
                    written.push(value.text);
                    self.scopes.push(n.clone());
                }
                let last = self.expr(&arguments[arguments.len() - 1]);
                self.scopes.truncate(depth);
                written.push(last?.text);
            }
            "FILTER" if arguments.len() > 2 => written = self.filter(arguments)?,
            // A LAMBDA is written only as MAP's, BYROW's or BYCOL's.
            "LAMBDA" => return None,
            "MAP" | "BYROW" | "BYCOL" => written = self.apply_lambda(Walk::of(name)?, arguments)?,
            _ => {
                for a in arguments {
                    written.push(self.expr(a)?.text);
                }
                match (name, arguments.len()) {
                    ("CEILING" | "FLOOR", 1) => written.push("1".into()),
                    ("ROUND" | "ROUNDDOWN" | "ROUNDUP", 1) => written.push("0".into()),
                    ("IFERROR", 1) => written.push(String::new()),
                    _ => {}
                }
            }
        }
        let prefix = if NEWER_IN_SHEETS.contains(&name) {
            "_xlfn._xlws."
        } else if NEWER.contains(&name) {
            "_xlfn."
        } else {
            ""
        };
        Some(Text::primary(format!("{prefix}{name}({})", written.join(","))))
    }

    /// FILTER's arguments as Excel takes them: the range, the conditions multiplied into one, and what it answers
    /// when nothing is left. The last argument is that answer when it is one value but not TRUE or FALSE; each
    /// condition must be as tall as the range and one column wide, or as wide and one row tall, and more than one
    /// cell (a condition of one cell does for a range of one row or column only when it is FILTER's only one).
    fn filter(&mut self, arguments: &[Expr]) -> Option<Vec<String>> {
        let range = self.shape(&arguments[0])?;
        let last = &arguments[arguments.len() - 1];
        let if_empty = !matches!(last, Expr::Boolean(_) | Expr::Array(_)) && self.shape(last) == Some((1, 1));
        let conditions = &arguments[1..arguments.len() - usize::from(if_empty)];
        for c in conditions {
            let (rows, columns) = self.shape(c)?;
            let is_a_column = rows == range.0 && columns == 1 && rows > 1;
            let is_a_row = rows == 1 && columns == range.1 && columns > 1;
            if !(is_a_column || is_a_row) {
                return None;
            }
        }
        let mut product = conditions[0].clone();
        for c in &conditions[1..] {
            product = Expr::Binary(BinaryOp::Multiply, Box::new(product), Box::new(c.clone()));
        }
        let mut written = vec![self.expr(&arguments[0])?.text, self.expr(&product)?.text];
        if if_empty {
            written.push(self.expr(last)?.text);
        }
        Some(written)
    }

    /// How many rows and columns an expression is, when that is known without working it out.
    fn shape(&self, expr: &Expr) -> Option<(usize, usize)> {
        match expr {
            Expr::Number(_) | Expr::Text(_) | Expr::Boolean(_) | Expr::Error(_) => Some((1, 1)),
            Expr::Reference(i) => {
                let at = self.workbook.locate(&self.formula.references[*i])?;
                Some((at.bottom.0 - at.top.0 + 1, at.right.0 - at.left.0 + 1))
            }
            Expr::Array(a) => Some((a.rows(), a.columns())),
            Expr::Unary(_, x) => self.shape(x),
            Expr::Binary(_, a, b) => {
                let (a, b) = (self.shape(a)?, self.shape(b)?);
                let side = |x: usize, y: usize| match (x, y) {
                    _ if x == y || y == 1 => Some(x),
                    (1, _) => Some(y),
                    _ => None,
                };
                Some((side(a.0, b.0)?, side(a.1, b.1)?))
            }
            _ => None,
        }
    }

    /// A reference as Excel reads it.
    fn reference(&self, i: usize) -> String {
        let reference = &self.formula.references[i];
        // A named range is written as its name, whether or not its cells are there; once removed, as `#REF!`.
        if let Reference::NamedRange { named_range_id } = reference {
            return match self.workbook.named_range(named_range_id) {
                Some(range) => range.name.clone(),
                None => CellError::Reference.text().to_owned(),
            };
        }
        let Some(at) = self.workbook.locate(reference) else {
            return CellError::Reference.text().to_owned();
        };
        let prefix =
            if at.sheet == self.sheet { String::new() } else { format!("{}!", sheet_name(&self.names[at.sheet])) };
        let dollar = |absolute: bool| if absolute { "$" } else { "" };
        let row = |(p, absolute): (usize, bool)| format!("{}{}", dollar(absolute), p + 1);
        let column = |(p, absolute): (usize, bool)| format!("{}{}", dollar(absolute), column_letters(p));
        let mut out = prefix;
        let _ = match reference {
            Reference::Cell { .. } => write!(out, "{}{}", column(at.left), row(at.top)),
            Reference::Range { .. } => {
                write!(out, "{}{}:{}{}", column(at.left), row(at.top), column(at.right), row(at.bottom))
            }
            Reference::Columns { top: None, .. } => write!(out, "{}:{}", column(at.left), column(at.right)),
            Reference::Columns { top: Some(_), .. } => {
                let bottom = format!("{}{LAST_ROW}", dollar(at.top.1));
                write!(out, "{}{}:{}{bottom}", column(at.left), row(at.top), column(at.right))
            }
            Reference::Rows { left: None, .. } => write!(out, "{}:{}", row(at.top), row(at.bottom)),
            Reference::Rows { left: Some(_), .. } => {
                let right = format!("{}{LAST_COLUMN}", dollar(at.left.1));
                write!(out, "{}{}:{right}{}", column(at.left), row(at.top), row(at.bottom))
            }
            // A connected table's cells, as a range.
            Reference::TableColumn { .. } | Reference::TablePart { .. } => {
                write!(out, "{}{}:{}{}", column(at.left), row(at.top), column(at.right), row(at.bottom))
            }
            Reference::NamedRange { .. } => unreachable!("written as its name above"),
        };
        out
    }
}

/// An operator's sign and how tightly it holds.
fn binary(op: BinaryOp) -> (&'static str, Tightness) {
    match op {
        BinaryOp::Add => ("+", Tightness::Additive),
        BinaryOp::Subtract => ("-", Tightness::Additive),
        BinaryOp::Multiply => ("*", Tightness::Term),
        BinaryOp::Divide => ("/", Tightness::Term),
        BinaryOp::Power => ("^", Tightness::Power),
        BinaryOp::Concat => ("&", Tightness::Concat),
        BinaryOp::Equal => ("=", Tightness::Comparison),
        BinaryOp::NotEqual => ("<>", Tightness::Comparison),
        BinaryOp::Less => ("<", Tightness::Comparison),
        BinaryOp::LessOrEqual => ("<=", Tightness::Comparison),
        BinaryOp::Greater => (">", Tightness::Comparison),
        BinaryOp::GreaterOrEqual => (">=", Tightness::Comparison),
    }
}

/// An error as a formula spells it, when Excel has it.
fn error_text(e: CellError) -> Option<&'static str> {
    match e {
        CellError::Spill | CellError::Error | CellError::Timeout => None,
        e => Some(e.text()),
    }
}

/// A value in an array written in a formula.
fn constant(v: &Value) -> Option<String> {
    Some(match v {
        Value::Blank => String::new(),
        Value::Number(n) => format!("{n}"),
        Value::Text(s) => format!("\"{}\"", s.replace('"', "\"\"")),
        Value::Boolean(b) => if *b { "TRUE" } else { "FALSE" }.to_owned(),
        Value::Error(e) => error_text(*e)?.to_owned(),
    })
}

/// A sheet's name as a reference in the file writes it: always quoted, whatever the name.
pub(super) fn sheet_name(name: &str) -> String {
    format!("'{}'", name.replace('\'', "''"))
}
