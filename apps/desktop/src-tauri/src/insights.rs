//! Build 23 Insights summary, the Rust side of the parity pair with
//! `packages/domain/src/insights/metrics.ts` (`summarize`). The desktop
//! computes Insights in TypeScript over Rust-stored values; this module defines
//! the same metrics over the same trades so `parity.rs` can generate the
//! expected outputs of `insights-metrics.json`, which both implementations run.
//! See docs/architecture/build-23-insights.md for the definitions.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::domain::{micros_to_string, parse_decimal, to_micros};

/// `INSIGHTS_MIN_SAMPLE` in the domain package.
pub const MIN_SAMPLE: usize = 5;

/// The fields of an Insights trade the summary reads (wire names).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricTrade {
    pub id: String,
    pub exit_at: Option<String>,
    pub pnl_status: String,
    pub fees: String,
    pub gross_pnl: Option<String>,
    pub realized_pnl: Option<String>,
    #[serde(default)]
    pub review: Option<MetricReview>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricReview {
    pub planned_risk: Option<String>,
    pub r_multiple: Option<String>,
}

fn micros(s: &str) -> Option<i128> {
    parse_decimal(s).and_then(to_micros).map(i128::from)
}

/// a ÷ b, half away from zero (b > 0).
fn div_round(a: i128, b: i128) -> i128 {
    let q = (a.abs() * 2 + b) / (2 * b);
    if a < 0 { -q } else { q }
}

/// n ÷ d as decimal text with at most `dp` decimals, half away from zero.
fn ratio_text(n: i128, d: i128, dp: u32) -> String {
    let scale = 10i128.pow(dp);
    let scaled = div_round(n * scale, d);
    let (neg, abs) = (scaled < 0, scaled.abs());
    let frac = format!("{:0width$}", abs % scale, width = dp as usize);
    let frac = frac.trim_end_matches('0');
    let sign = if neg { "-" } else { "" };
    if frac.is_empty() {
        format!("{sign}{}", abs / scale)
    } else {
        format!("{sign}{}.{frac}", abs / scale)
    }
}

fn value(v: impl Into<Value>) -> Value {
    json!({ "state": "value", "value": v.into() })
}
fn state(state: &str, code: &str) -> Value {
    json!({ "state": state, "code": code })
}
fn insufficient(have: usize) -> Value {
    json!({ "state": "insufficient", "code": "below_min_sample", "have": have, "need": MIN_SAMPLE })
}
fn money(m: i128) -> Value {
    match i64::try_from(m) {
        Ok(m) => value(micros_to_string(m)),
        Err(_) => state("unavailable", "too_large"),
    }
}

/// The parity projection of the summary: counts, ids and every metric as `{state, value | code}`.
pub fn summarize(trades: &[MetricTrade]) -> Value {
    let closed: Vec<&MetricTrade> = trades
        .iter()
        .filter(|t| t.exit_at.is_some() && t.pnl_status != "open")
        .collect();
    let mut eligible: Vec<(&MetricTrade, i128, i128, i128)> = Vec::new();
    let mut unknown: Vec<&str> = Vec::new();
    for t in &closed {
        match (
            t.realized_pnl.as_deref().and_then(micros),
            t.gross_pnl.as_deref().and_then(micros),
            micros(&t.fees),
        ) {
            (Some(net), Some(gross), Some(fees)) => eligible.push((t, net, gross, fees)),
            _ => unknown.push(&t.id),
        }
    }
    let wins: Vec<_> = eligible.iter().filter(|e| e.1 > 0).collect();
    let losses: Vec<_> = eligible.iter().filter(|e| e.1 < 0).collect();
    let breakevens: Vec<_> = eligible.iter().filter(|e| e.1 == 0).collect();
    let with_r: Vec<(&str, i128)> = eligible
        .iter()
        .filter_map(|e| {
            let review = e.0.review.as_ref()?;
            review.planned_risk.as_ref()?;
            Some((e.0.id.as_str(), micros(review.r_multiple.as_deref()?)?))
        })
        .collect();

    let n = eligible.len();
    let none_known = || {
        if closed.is_empty() {
            state("na", "no_closed_trades")
        } else {
            state("unavailable", "pnl_unknown")
        }
    };
    let net: i128 = eligible.iter().map(|e| e.1).sum();
    let gross: i128 = eligible.iter().map(|e| e.2).sum();
    let fees: i128 = eligible.iter().map(|e| e.3).sum();
    let win_sum: i128 = wins.iter().map(|e| e.1).sum();
    let loss_sum: i128 = losses.iter().map(|e| e.1).sum();
    let mean = |total: i128, count: usize| money(div_round(total, count as i128));
    let ids = |list: &[&&(&MetricTrade, i128, i128, i128)]| {
        list.iter().map(|e| e.0.id.clone()).collect::<Vec<_>>()
    };

    json!({
        "tradeIds": closed.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
        "eligibleIds": eligible.iter().map(|e| e.0.id.clone()).collect::<Vec<_>>(),
        "unknownIds": unknown,
        "winIds": ids(&wins.iter().collect::<Vec<_>>()),
        "lossIds": ids(&losses.iter().collect::<Vec<_>>()),
        "breakevenIds": ids(&breakevens.iter().collect::<Vec<_>>()),
        "rIds": with_r.iter().map(|r| r.0).collect::<Vec<_>>(),
        "closed": closed.len(),
        "eligible": n,
        "unknownPnl": unknown.len(),
        "wins": wins.len(),
        "losses": losses.len(),
        "breakevens": breakevens.len(),
        "complete": unknown.is_empty(),
        "net": if n > 0 { money(net) } else { none_known() },
        "gross": if n > 0 { money(gross) } else { none_known() },
        "fees": if n > 0 { money(fees) } else { none_known() },
        "winRate": if n > 0 {
            value(json!({ "numerator": wins.len(), "denominator": n, "percent": ratio_text(wins.len() as i128 * 100, n as i128, 1) }))
        } else { none_known() },
        "averageWin": if n == 0 { none_known() } else if wins.is_empty() { state("na", "no_winners") } else { mean(win_sum, wins.len()) },
        "averageLoss": if n == 0 { none_known() } else if losses.is_empty() { state("na", "no_losers") } else { mean(loss_sum, losses.len()) },
        "expectancy": if n == 0 { none_known() } else if n < MIN_SAMPLE { insufficient(n) } else { mean(net, n) },
        "expectancyGross": if n == 0 { none_known() } else if n < MIN_SAMPLE { insufficient(n) } else { mean(gross, n) },
        "profitFactor": if n == 0 { none_known() } else if n < MIN_SAMPLE { insufficient(n) }
            else if losses.is_empty() { state("na", "no_losers") } else { value(ratio_text(win_sum, -loss_sum, 2)) },
        "averageR": if n == 0 { none_known() } else if with_r.is_empty() { state("na", "no_planned_risk") }
            else if with_r.len() < MIN_SAMPLE { insufficient(with_r.len()) }
            else { value(ratio_text(with_r.iter().map(|r| r.1).sum(), with_r.len() as i128 * 1_000_000, 2)) },
    })
}

#[cfg(test)]
mod tests {
    use super::ratio_text;

    #[test]
    fn ratios_round_half_away_from_zero() {
        assert_eq!(ratio_text(2, 3, 1), "0.7");
        assert_eq!(ratio_text(-1, 8, 2), "-0.13");
        assert_eq!(ratio_text(1, 8, 2), "0.13");
        assert_eq!(ratio_text(100, 1, 2), "100");
        assert_eq!(
            ratio_text(-1, 1000, 2),
            "0",
            "a value that rounds to zero has no sign"
        );
    }
}
