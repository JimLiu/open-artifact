//! The probability distributions and tests:
//! BETA.DIST BETA.INV BETADIST BETAINV BINOM.DIST BINOM.DIST.RANGE BINOM.INV BINOMDIST CHIDIST CHIINV
//! CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CHITEST CONFIDENCE CONFIDENCE.NORM CONFIDENCE.T
//! CRITBINOM EXPON.DIST EXPONDIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FDIST FINV FISHER FISHERINV FTEST
//! GAMMA GAMMA.DIST GAMMA.INV GAMMADIST GAMMAINV GAMMALN GAMMALN.PRECISE HYPGEOM.DIST HYPGEOMDIST LOGINV
//! LOGNORM.DIST LOGNORM.INV LOGNORMDIST NEGBINOM.DIST NEGBINOMDIST NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV
//! NORMDIST NORMINV NORMSDIST NORMSINV POISSON POISSON.DIST PROB T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T
//! T.TEST TDIST TINV TTEST WEIBULL WEIBULL.DIST Z.TEST ZTEST
//!
//! Arguments are read in order before anything is worked out: a whole-number argument
//! is cut to a whole number (a count below 0, or a degree of freedom below 1, is #NUM!); counts from 2⁵³ on are
//! #NUM!.

mod dist;
mod special;

use std::cmp::Ordering;

use self::dist::*;
use self::special::{lgamma, tgamma};
use crate::coerce;
use crate::functions::{number, numbers_of, Answer, Arg, CallContext};
use crate::locale::Locale;
use crate::value::{CellError, Value};
use crate::told::{self, Told};

const BIG: f64 = 9_007_199_254_740_992.0; // 2⁵³

/// Calls a distribution function by name; `None` for a name that is not one.
pub fn call(name: &str, args: &[Arg], cx: &mut CallContext) -> Option<Answer> {
    let a = Args { args, locale: cx.locale };
    let got = match name {
        "BETA.DIST" => beta_dist(&a, true),
        "BETADIST" => beta_dist(&a, false),
        "BETA.INV" | "BETAINV" => beta_inverse(&a),
        "BINOM.DIST" | "BINOMDIST" => binom_dist(&a),
        "BINOM.DIST.RANGE" => binom_dist_range(&a),
        "BINOM.INV" | "CRITBINOM" => binom_inverse(&a),
        "CHISQ.DIST" => chisq_dist(&a),
        "CHISQ.DIST.RT" | "CHIDIST" => chisq_dist_rt(&a),
        "CHISQ.INV" => chisq_inverse(&a, false),
        "CHISQ.INV.RT" | "CHIINV" => chisq_inverse(&a, true),
        "CHISQ.TEST" | "CHITEST" => chisq_test(&a),
        "CONFIDENCE" | "CONFIDENCE.NORM" => confidence_norm(&a),
        "CONFIDENCE.T" => confidence_t(&a),
        "EXPON.DIST" | "EXPONDIST" => expon_dist(&a),
        "F.DIST" => f_dist(&a),
        "F.DIST.RT" | "FDIST" => f_dist_rt(&a),
        "F.INV" => f_inverse(&a, false),
        "F.INV.RT" | "FINV" => f_inverse(&a, true),
        "F.TEST" | "FTEST" => f_test(&a),
        "FISHER" => a.number(0).map(|x| (x.ln_1p() - (-x).ln_1p()) * 0.5),
        "FISHERINV" => a.number(0).map(|y| {
            let e = (y.abs() * -2.0).exp_m1();
            let r = e / (e + 2.0);
            if y > 0.0 {
                -r
            } else {
                r
            }
        }),
        "GAMMA" => a.number(0).map(tgamma),
        "GAMMALN" | "GAMMALN.PRECISE" => a.number(0).and_then(|x| if x <= 0.0 { Err(CellError::Number) } else { Ok(lgamma(x)) }),
        "GAMMA.DIST" | "GAMMADIST" => gamma_dist(&a),
        "GAMMA.INV" | "GAMMAINV" => gamma_inverse(&a),
        "HYPGEOM.DIST" => hypgeom_dist(&a, true),
        "HYPGEOMDIST" => hypgeom_dist(&a, false),
        "LOGNORM.DIST" => lognorm_dist(&a, true),
        "LOGNORMDIST" => lognorm_dist(&a, false),
        "LOGNORM.INV" | "LOGINV" => norm_inverse(&a, true),
        "NEGBINOM.DIST" => negbinom_dist(&a, true),
        "NEGBINOMDIST" => negbinom_dist(&a, false),
        "NORM.DIST" | "NORMDIST" => norm_dist(&a),
        "NORM.INV" | "NORMINV" => norm_inverse(&a, false),
        "NORM.S.DIST" => (|| -> Got<f64> {
            let z = a.number(0)?;
            Ok(if a.boolean(1)? { norm_cdf(z) } else { norm_pdf(z) })
        })(),
        "NORMSDIST" => a.number(0).map(norm_cdf),
        "NORM.S.INV" | "NORMSINV" => a.number(0).and_then(norm_inv),
        "POISSON" | "POISSON.DIST" => poisson(&a),
        "PROB" => prob(&a),
        "T.DIST" => t_dist(&a),
        "T.DIST.2T" => (|| -> Got<f64> {
            let (x, df) = (a.number(0)?, a.positive(1)?);
            if x < 0.0 {
                return Err(CellError::Number);
            }
            t_2t(below_big(df)?, x)
        })(),
        "T.DIST.RT" => (|| -> Got<f64> {
            let (x, df) = (a.number(0)?, a.positive(1)?);
            let v = t_2t(below_big(df)?, x)?;
            Ok(if x > 0.0 { v * 0.5 } else { 1.0 - v * 0.5 })
        })(),
        "TDIST" => (|| -> Got<f64> {
            let (x, df, tails) = (a.number(0)?, a.positive(1)?, a.whole(2)?);
            if x < 0.0 {
                return Err(CellError::Number);
            }
            t_tails(below_big(df)?, x, tails)
        })(),
        "T.INV" => (|| -> Got<f64> {
            let (p, df) = (a.number(0)?, a.positive(1)?);
            let m = p.min(1.0 - p);
            let t = t_inv(below_big(df)?, m + m)?;
            Ok(if p < 0.5 { -t } else { t })
        })(),
        "T.INV.2T" | "TINV" => (|| -> Got<f64> {
            let (p, df) = (a.number(0)?, a.positive(1)?);
            t_inv(below_big(df)?, p)
        })(),
        "T.TEST" | "TTEST" => t_test(&a),
        "WEIBULL" | "WEIBULL.DIST" => weibull(&a),
        "Z.TEST" | "ZTEST" => z_test(&a),
        _ => return None,
    };
    Some(got.and_then(|v| number(if v == 0.0 { 0.0 } else { v })))
}

/// How these functions' arguments are read early (see `functions::early_reads`). A degree of freedom or a
/// count that must be 1 or more is `p` (#NUM! below 1).
pub fn early_reads(name: &str) -> Option<&'static str> {
    Some(match name {
        "BETA.INV" | "BETADIST" | "BETAINV" => "nnnn",
        "CONFIDENCE" | "CONFIDENCE.NORM" | "CONFIDENCE.T" | "EXPON.DIST" | "EXPONDIST" | "GAMMA.INV" | "GAMMAINV"
        | "LOGINV" | "LOGNORM.INV" | "LOGNORMDIST" | "NORM.INV" | "NORMINV" | "Z.TEST" | "ZTEST" => "nn",
        "CHIDIST" | "CHIINV" | "CHISQ.DIST.RT" | "CHISQ.INV" | "CHISQ.INV.RT" | "F.TEST" | "FTEST" | "NORM.S.DIST"
        | "T.DIST.2T" | "T.DIST.RT" | "T.INV" | "T.INV.2T" | "TINV" => "n",
        "BINOM.INV" | "CRITBINOM" | "POISSON" | "POISSON.DIST" => "yn",
        "BETA.DIST" => "nnnbn",
        "BINOM.DIST" | "BINOMDIST" => "yyn",
        "BINOM.DIST.RANGE" => "yny",
        "GAMMA.DIST" | "GAMMADIST" | "LOGNORM.DIST" | "NORM.DIST" | "NORMDIST" | "WEIBULL" | "WEIBULL.DIST" => "nnn",
        "PROB" => "..n",
        "T.TEST" | "TTEST" => "..nn",
        "CHISQ.DIST" | "F.DIST.RT" | "F.INV" | "F.INV.RT" | "FDIST" | "FINV" | "T.DIST" | "TDIST" => "np",
        "F.DIST" => "npp",
        "HYPGEOM.DIST" => "yppp",
        "HYPGEOMDIST" => "ypp",
        "NEGBINOM.DIST" => "ypn",
        "NEGBINOMDIST" => "yp",
        _ => return None,
    })
}

/// A call's arguments, read and prepared.
struct Args<'a> {
    args: &'a [Arg],
    locale: &'static Locale,
}

impl Args<'_> {
    /// Whether the call has an argument at `i`; a blank one counts and reads as 0.
    fn given(&self, i: usize) -> bool {
        i < self.args.len()
    }

    fn number(&self, i: usize) -> Got<f64> {
        self.args.get(i).map_or(Ok(0.0), |a| a.number(self.locale))
    }

    fn number_or(&self, i: usize, default: f64) -> Got<f64> {
        if self.given(i) {
            self.number(i)
        } else {
            Ok(default)
        }
    }

    fn boolean(&self, i: usize) -> Got<bool> {
        self.args.get(i).map_or(Ok(false), |a| a.boolean())
    }

    /// A whole number (cut toward 0).
    fn whole(&self, i: usize) -> Got<f64> {
        Ok(self.number(i)?.trunc())
    }

    /// A count: 0 or more, else #NUM!.
    fn count(&self, i: usize) -> Got<f64> {
        let n = self.number(i)?;
        if n < 0.0 {
            return Err(CellError::Number);
        }
        Ok(n.trunc())
    }

    /// A whole number of 1 or more (degrees of freedom, sizes), else #NUM!.
    fn positive(&self, i: usize) -> Got<f64> {
        let n = self.number(i)?;
        if n < 1.0 {
            return Err(CellError::Number);
        }
        Ok(n.trunc())
    }

    /// The numbers of a list argument, as SUM reads them.
    fn numbers(&self, i: usize) -> Got<Vec<f64>> {
        numbers_of(&self.args[i..=i], self.locale)
    }
}

fn below_big(n: f64) -> Got<f64> {
    if n.abs() < BIG {
        Ok(n)
    } else {
        Err(CellError::Number)
    }
}

/// The numbers of a cells argument with where each is (row, column), and the argument's size. Other values are
/// passed over; an error is the answer. One value is a list of one cell: a number counts, text does not.
fn placed_numbers(arg: &Arg) -> Got<((usize, usize), Vec<(usize, usize, f64)>)> {
    match arg {
        Arg::Cells(cells) => {
            let mut out = Vec::new();
            for r in 0..cells.rows() {
                for c in 0..cells.columns() {
                    match cells.get(r, c) {
                        Value::Number(n) => out.push((r, c, *n)),
                        Value::Error(e) => return Err(*e),
                        _ => {}
                    }
                }
            }
            Ok(((cells.rows(), cells.columns()), out))
        }
        Arg::Value(Value::Number(n)) => Ok(((1, 1), vec![(0, 0, *n)])),
        Arg::Value(Value::Error(e)) => Err(*e),
        Arg::Value(_) | Arg::Missing => Ok(((1, 1), Vec::new())),
        Arg::Place(_) => Err(CellError::Value),
    }
}

/// The pairs of numbers at the same place in both lists.
fn pairs(first: &[(usize, usize, f64)], second: &[(usize, usize, f64)]) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    let mut j = 0;
    for &(r, c, x) in first {
        while j < second.len() && (second[j].0, second[j].1) < (r, c) {
            j += 1;
        }
        if j < second.len() && (second[j].0, second[j].1) == (r, c) {
            out.push((x, second[j].2));
        }
    }
    out
}

fn beta_dist(a: &Args, has_cumulative: bool) -> Got<f64> {
    let (x, alpha, beta) = (a.number(0)?, a.number(1)?, a.number(2)?);
    let (cumulative, at) = if has_cumulative { (a.boolean(3)?, 4) } else { (true, 3) };
    let (lo, hi) = (a.number_or(at, 0.0)?, a.number_or(at + 1, 1.0)?);
    if alpha <= 0.0 || beta <= 0.0 || lo >= hi || x < lo || x > hi {
        return Err(CellError::Number);
    }
    let width = hi - lo;
    let y = (hi - x) / width;
    let x = (x - lo) / width;
    if cumulative {
        Ok(beta_inc(alpha, beta, x, y)?.0)
    } else {
        Ok(beta_pdf(alpha, beta, x, y) / width)
    }
}

fn beta_inverse(a: &Args) -> Got<f64> {
    let (p, alpha, beta) = (a.number(0)?, a.number(1)?, a.number(2)?);
    let (lo, hi) = (a.number_or(3, 0.0)?, a.number_or(4, 1.0)?);
    if p <= 0.0 || p >= 1.0 || lo >= hi || alpha <= 0.0 || beta <= 0.0 {
        return Err(CellError::Number);
    }
    let r = beta_inv(alpha, beta, p, 1.0 - p)?;
    Ok(lo + ((hi - lo) * (1.0 / ((1.0 / r) + 1.0))))
}

fn binom_dist(a: &Args) -> Got<f64> {
    let (k, n, p, cumulative) = (a.count(0)?, a.count(1)?, a.number(2)?, a.boolean(3)?);
    if n >= BIG || p < 0.0 || p > 1.0 || n < k || k >= BIG {
        return Err(CellError::Number);
    }
    if cumulative {
        Ok(binom_cdf(n, p, 1.0 - p, k)?.0)
    } else {
        Ok(binom_term(k, n - k, p, 1.0 - p))
    }
}

fn binom_dist_range(a: &Args) -> Got<f64> {
    let (n, p, s) = (a.count(0)?, a.number(1)?, a.count(2)?);
    let s2 = if a.given(3) { a.count(3)? } else { s };
    if s2 < s || n >= BIG || p < 0.0 || p > 1.0 || s >= BIG || n < s || s2 >= BIG || n < s2 {
        return Err(CellError::Number);
    }
    let q = 1.0 - p;
    if s2 == s {
        return Ok(binom_term(s, n - s, p, q));
    }
    let (below_lower, below_upper) = binom_cdf(n, p, q, s - 1.0)?;
    let (upto_lower, upto_upper) = binom_cdf(n, p, q, s2)?;
    Ok(if upto_lower < below_upper { upto_lower - below_lower } else { below_upper - upto_upper })
}

fn binom_inverse(a: &Args) -> Got<f64> {
    let (n, p, alpha) = (a.count(0)?, a.number(1)?, a.number(2)?);
    if !(alpha >= 0.0) || alpha > 1.0 || n >= BIG || p < 0.0 || p > 1.0 {
        return Err(CellError::Number);
    }
    if alpha >= 1.0 && p > 0.0 {
        return Ok(n);
    }
    let tolerance = alpha.min(1.0 - alpha) * 1e-13;
    let (mut lo, mut hi) = (-1.0, n);
    let mut width = n + 1.0;
    while width > 1.0 {
        let mid = lo + (width * 0.5).floor();
        if nearly_compare(tolerance + binom_cdf(n, p, 1.0 - p, mid)?.0, alpha) == Ordering::Less {
            lo = mid;
        } else {
            hi = mid;
        }
        width = hi - lo;
    }
    Ok(hi)
}

fn chisq_dist(a: &Args) -> Got<f64> {
    let (x, df, cumulative) = (a.number(0)?, a.positive(1)?, a.boolean(2)?);
    if x < 0.0 {
        return Err(CellError::Number);
    }
    let k = below_big(df)? * 0.5;
    if cumulative {
        Ok(gamma_inc(k, x * 0.5)?.0)
    } else {
        Ok(gamma_pdf(k, x * 0.5) * 0.5)
    }
}

fn chisq_dist_rt(a: &Args) -> Got<f64> {
    let (x, df) = (a.number(0)?, a.positive(1)?);
    if x < 0.0 {
        return Err(CellError::Number);
    }
    Ok(gamma_inc(below_big(df)? * 0.5, x * 0.5)?.1)
}

fn chisq_inverse(a: &Args, right: bool) -> Got<f64> {
    let (p, df) = (a.number(0)?, a.positive(1)?);
    let k = below_big(df)? * 0.5;
    if !(p >= 0.0) || p > 1.0 {
        return Err(CellError::Number);
    }
    let v = if right { gamma_inv(k, 1.0 - p, p)? } else { gamma_inv(k, p, 1.0 - p)? };
    Ok(v + v)
}

fn chisq_test(a: &Args) -> Got<f64> {
    let (actual_size, actual) = placed_numbers(&a.args[0])?;
    let (expected_size, expected) = placed_numbers(&a.args[1])?;
    if actual_size != expected_size {
        told::tell(|| Told::RangesOfDifferentSizes);
        return Err(CellError::NotAvailable);
    }
    let (rows, columns) = (actual_size.0 as f64 - 1.0, actual_size.1 as f64 - 1.0);
    if rows + columns == 0.0 {
        return Err(CellError::NotAvailable);
    }
    let mut sum = None;
    for (x, e) in pairs(&actual, &expected) {
        if e == 0.0 {
            return Err(CellError::DivideByZero);
        }
        let d = x - e;
        sum = Some(sum.unwrap_or(0.0) + (d * d) / e);
    }
    let sum = sum.ok_or(CellError::DivideByZero)?;
    if sum < 0.0 {
        return Err(CellError::Number);
    }
    Ok(gamma_inc((rows.max(1.0) * columns.max(1.0)) * 0.5, sum * 0.5)?.1)
}

fn confidence_norm(a: &Args) -> Got<f64> {
    let (alpha, sigma, n) = (a.number(0)?, a.number(1)?, a.positive(2)?);
    if alpha >= 1.0 || sigma <= 0.0 {
        return Err(CellError::Number);
    }
    let z = norm_inv(alpha * 0.5)?;
    Ok((sigma * -z) / below_big(n)?.sqrt())
}

fn confidence_t(a: &Args) -> Got<f64> {
    let (alpha, sigma, n) = (a.number(0)?, a.number(1)?, a.positive(2)?);
    if alpha <= 0.0 || alpha >= 1.0 || sigma <= 0.0 {
        return Err(CellError::Number);
    }
    if n == 1.0 {
        return Err(CellError::DivideByZero);
    }
    let n = below_big(n)?;
    let t = t_inv(n - 1.0, alpha)?;
    Ok((sigma * t) / n.sqrt())
}

fn expon_dist(a: &Args) -> Got<f64> {
    let (x, lambda, cumulative) = (a.number(0)?, a.number(1)?, a.boolean(2)?);
    if x < 0.0 || lambda <= 0.0 {
        return Err(CellError::Number);
    }
    let v = x * -lambda;
    Ok(if cumulative { -v.exp_m1() } else { lambda * v.exp() })
}

/// The halved degrees of freedom of an F distribution's arguments 1 and 2.
fn f_halves(a: &Args) -> Got<(f64, f64)> {
    let (d1, d2) = (a.positive(1)?, a.positive(2)?);
    Ok((below_big(d1)? * 0.5, below_big(d2)? * 0.5))
}

fn f_dist(a: &Args) -> Got<f64> {
    let x = a.number(0)?;
    let (d1, d2) = (a.positive(1)?, a.positive(2)?);
    let cumulative = a.boolean(3)?;
    let (h1, h2) = (below_big(d1)? * 0.5, below_big(d2)? * 0.5);
    if cumulative {
        Ok(f_cdf(h1, h2, x)?.0)
    } else {
        f_pdf(h1, h2, x)
    }
}

fn f_dist_rt(a: &Args) -> Got<f64> {
    let x = a.number(0)?;
    let (h1, h2) = f_halves(a)?;
    Ok(f_cdf(h1, h2, x)?.1)
}

fn f_inverse(a: &Args, right: bool) -> Got<f64> {
    let p = a.number(0)?;
    let (h1, h2) = f_halves(a)?;
    if !(p >= 0.0) || p > 1.0 {
        return Err(CellError::Number);
    }
    if right {
        f_inv(h1, h2, 1.0 - p, p)
    } else {
        f_inv(h1, h2, p, 1.0 - p)
    }
}

fn f_test(a: &Args) -> Got<f64> {
    let (first, second) = (a.numbers(0)?, a.numbers(1)?);
    let (n1, _, ss1) = stats(&first)?;
    let (n2, _, ss2) = stats(&second)?;
    if ss1 == 0.0 || n1 < 2.0 || ss2 == 0.0 || n2 < 2.0 {
        return Err(CellError::DivideByZero);
    }
    let (k1, k2) = (n1 - 1.0, n2 - 1.0);
    let (lower, upper) = f_cdf(k1 * 0.5, k2 * 0.5, (ss1 / k1) / (ss2 / k2))?;
    let m = lower.min(upper);
    Ok(m + m)
}

fn gamma_dist(a: &Args) -> Got<f64> {
    let (x, alpha, beta, cumulative) = (a.number(0)?, a.number(1)?, a.number(2)?, a.boolean(3)?);
    if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
        return Err(CellError::Number);
    }
    if cumulative {
        Ok(gamma_inc(alpha, x / beta)?.0)
    } else {
        Ok(gamma_pdf(alpha, x / beta) / beta)
    }
}

fn gamma_inverse(a: &Args) -> Got<f64> {
    let (p, alpha, beta) = (a.number(0)?, a.number(1)?, a.number(2)?);
    if alpha <= 0.0 || beta <= 0.0 || !(p >= 0.0) || p > 1.0 {
        return Err(CellError::Number);
    }
    Ok(beta * gamma_inv(alpha, p, 1.0 - p)?)
}

fn hypgeom_dist(a: &Args, has_cumulative: bool) -> Got<f64> {
    let (k, n, big_k, big_n) = (a.count(0)?, a.positive(1)?, a.positive(2)?, a.positive(3)?);
    let cumulative = has_cumulative && a.boolean(4)?;
    let table = hypgeom_table(k, n, big_k, big_n)?;
    if cumulative {
        hypgeom_cdf(table)
    } else {
        Ok(hypgeom_pdf(table))
    }
}

fn lognorm_dist(a: &Args, has_cumulative: bool) -> Got<f64> {
    let (x, mean, sigma) = (a.number(0)?, a.number(1)?, a.number(2)?);
    let cumulative = !has_cumulative || a.boolean(3)?;
    if x <= 0.0 || sigma <= 0.0 {
        return Err(CellError::Number);
    }
    let z = (x.ln() - mean) / sigma;
    Ok(if cumulative { norm_cdf(z) } else { (norm_pdf(z) / sigma) / x })
}

fn negbinom_dist(a: &Args, has_cumulative: bool) -> Got<f64> {
    let (failures, successes, p) = (a.count(0)?, a.positive(1)?, a.number(2)?);
    let cumulative = has_cumulative && a.boolean(3)?;
    if p <= 0.0 || p >= 1.0 {
        return Err(CellError::Number);
    }
    let r = below_big(successes)?;
    let f = below_big(failures)?;
    if cumulative {
        Ok(beta_inc(r, f + 1.0, p, 1.0 - p)?.0)
    } else {
        Ok((r / (f + r)) * binom_term(r, f, p, 1.0 - p))
    }
}

fn norm_dist(a: &Args) -> Got<f64> {
    let (x, mean, sigma, cumulative) = (a.number(0)?, a.number(1)?, a.number(2)?, a.boolean(3)?);
    if sigma <= 0.0 {
        return Err(CellError::Number);
    }
    let z = (x - mean) / sigma;
    Ok(if cumulative { norm_cdf(z) } else { norm_pdf(z) / sigma })
}

/// NORM.INV, or LOGNORM.INV when `log`.
fn norm_inverse(a: &Args, log: bool) -> Got<f64> {
    let (p, mean, sigma) = (a.number(0)?, a.number(1)?, a.number(2)?);
    if sigma <= 0.0 {
        return Err(CellError::Number);
    }
    let v = (sigma * norm_inv(p)?) + mean;
    Ok(if log { v.exp() } else { v })
}

fn poisson(a: &Args) -> Got<f64> {
    let (k, lambda, cumulative) = (a.count(0)?, a.number(1)?, a.boolean(2)?);
    if lambda < 0.0 {
        return Err(CellError::Number);
    }
    let k = below_big(k)?;
    if cumulative {
        Ok(gamma_inc(k + 1.0, lambda)?.1)
    } else {
        Ok(pois_d(k, lambda))
    }
}

fn prob(a: &Args) -> Got<f64> {
    let lower = a.number(2)?;
    let upper = if a.given(3) { a.number(3)? } else { lower };
    let (values_size, values) = placed_numbers(&a.args[0])?;
    let (probabilities_size, probabilities) = placed_numbers(&a.args[1])?;
    if values_size != probabilities_size {
        told::tell(|| Told::RangesOfDifferentSizes);
        return Err(CellError::Value);
    }
    let (lo, hi) = (lower.min(upper), lower.max(upper));
    let pairs = pairs(&values, &probabilities);
    if pairs.is_empty() {
        return Err(CellError::Number);
    }
    let mut total = 0.0;
    let mut inside = 0.0;
    for (x, p) in pairs {
        if nearly_compare(x, lo) != Ordering::Less && nearly_compare(x, hi) != Ordering::Greater {
            inside = coerce::add(inside, p);
        }
        total += p;
    }
    if (total - 1.0).abs() > 1e-9 {
        return Err(CellError::Number);
    }
    Ok(inside)
}

fn t_dist(a: &Args) -> Got<f64> {
    let (x, df, cumulative) = (a.number(0)?, a.positive(1)?, a.boolean(2)?);
    let df = below_big(df)?;
    if cumulative {
        t_cdf_of_negated(df, -x)
    } else {
        Ok(t_pdf(df, x))
    }
}

fn t_test(a: &Args) -> Got<f64> {
    let (tails, kind) = (a.whole(2)?, a.whole(3)?);
    let (first_size, first) = placed_numbers(&a.args[0])?;
    let (second_size, second) = placed_numbers(&a.args[1])?;
    let (difference, variance, df) = match kind as i64 {
        1 => {
            if first_size != second_size {
                told::tell(|| Told::RangesOfDifferentSizes);
                return Err(CellError::NotAvailable);
            }
            let d: Vec<f64> = pairs(&first, &second).into_iter().map(|(x, y)| x - y).collect();
            let (n, mean, ss) = stats(&d)?;
            if n < 2.0 {
                return Err(CellError::DivideByZero);
            }
            let k = n - 1.0;
            (mean, (ss / k) / n, k)
        }
        2 | 3 => {
            let one: Vec<f64> = first.iter().map(|e| e.2).collect();
            let two: Vec<f64> = second.iter().map(|e| e.2).collect();
            let (n1, m1, ss1) = stats(&one)?;
            let (n2, m2, ss2) = stats(&two)?;
            if n1 < 2.0 || n2 < 2.0 {
                return Err(CellError::DivideByZero);
            }
            let (k1, k2) = (n1 - 1.0, n2 - 1.0);
            if kind == 2.0 {
                let df = (n1 + n2) - 2.0;
                (m1 - m2, ((1.0 / n1) + (1.0 / n2)) * (((k1 * (ss1 / k1)) + (k2 * (ss2 / k2))) / df), df)
            } else {
                let v1 = (ss1 / k1) / n1;
                let variance = v1 + ((ss2 / k2) / n2);
                let r = v1 / variance;
                let s = 1.0 - r;
                (m1 - m2, variance, 1.0 / (((r * r) / k1) + ((s * s) / k2)))
            }
        }
        _ => return Err(CellError::Number),
    };
    if variance == 0.0 {
        return Err(CellError::DivideByZero);
    }
    t_tails(df, difference / variance.sqrt(), tails)
}

fn weibull(a: &Args) -> Got<f64> {
    let (x, alpha, beta, cumulative) = (a.number(0)?, a.number(1)?, a.number(2)?, a.boolean(3)?);
    if x < 0.0 || alpha <= 0.0 || beta <= 0.0 {
        return Err(CellError::Number);
    }
    let v = x / beta;
    let t = -v.powf(alpha);
    if cumulative {
        return Ok(-t.exp_m1());
    }
    let e = t.exp();
    if e == 0.0 {
        return Ok(0.0);
    }
    Ok(e * ((alpha / beta) * v.powf(alpha - 1.0)))
}

fn z_test(a: &Args) -> Got<f64> {
    let list = a.numbers(0)?;
    let x = a.number(1)?;
    let sigma = if a.given(2) { Some(a.number(2)?) } else { None };
    if list.is_empty() {
        return Err(CellError::NotAvailable);
    }
    let (n, mean, ss) = stats(&list)?;
    let sigma = match sigma {
        Some(s) if s <= 0.0 => return Err(CellError::Number),
        Some(s) => s,
        None if ss == 0.0 || n < 2.0 => return Err(CellError::DivideByZero),
        None => (ss / (n - 1.0)).sqrt(),
    };
    Ok(special::erfc((((mean - x) / sigma) * n.sqrt()) * 0.7071067811865476) * 0.5)
}
