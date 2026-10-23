//! Strict parsers for CSV cell values. Each returns a message suitable for a
//! row-level error; none of them guesses at a malformed value.

use std::str::FromStr;

use chrono::{DateTime, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::domain::parse_instant;

/// Digits with optional, well-formed thousands separators and an optional
/// fractional part: `1234`, `1,234.50`, `.5`. No sign, currency or exponent.
fn parse_unsigned(body: &str) -> Option<Decimal> {
    let (int, frac) = match body.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (body, None),
    };
    if let Some(f) = frac
        && (f.is_empty() || !f.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let digits = if int.contains(',') {
        let mut groups = int.split(',');
        let first = groups.next()?;
        if first.is_empty() || first.len() > 3 || !first.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let mut out = first.to_string();
        for g in groups {
            if g.len() != 3 || !g.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            out.push_str(g);
        }
        out
    } else {
        if !int.bytes().all(|b| b.is_ascii_digit()) || (int.is_empty() && frac.is_none()) {
            return None;
        }
        int.to_string()
    };
    let text = match frac {
        Some(f) => format!("{}.{f}", if digits.is_empty() { "0" } else { &digits }),
        None => digits,
    };
    Decimal::from_str(&text).ok()
}

/// A plain number with an optional leading sign: quantities and prices.
pub fn parse_number(s: &str) -> Result<Decimal, String> {
    let t = s.trim();
    if t.is_empty() {
        return Err("is empty".into());
    }
    let (negative, body) = match t.as_bytes()[0] {
        b'-' => (true, &t[1..]),
        b'+' => (false, &t[1..]),
        _ => (false, t),
    };
    let value = parse_unsigned(body).ok_or_else(|| format!("'{t}' is not a number"))?;
    Ok(if negative { -value } else { value })
}

/// A money amount as platforms export it: `26.00`, `$26.00`, `-$26.00`,
/// `$-26.00`, `$(36.00)`, `($36.00)`, `(36.00)`, `$1,234.50`.
pub fn parse_money(s: &str) -> Result<Decimal, String> {
    let t = s.trim();
    if t.is_empty() {
        return Err("is empty".into());
    }
    let invalid =
        || format!("'{t}' is not a money amount (examples: 26.00, $26.00, -$26.00, $(36.00))");
    let (mut rest, mut dollar, mut sign, mut paren, mut negative) = (t, false, false, false, false);
    loop {
        match rest.as_bytes().first() {
            Some(b'$') if !dollar => dollar = true,
            Some(b'-') if !sign && !paren => {
                sign = true;
                negative = true;
            }
            Some(b'+') if !sign && !paren => sign = true,
            Some(b'(') if !sign && !paren => paren = true,
            _ => break,
        }
        rest = &rest[1..];
    }
    if paren {
        rest = rest.strip_suffix(')').ok_or_else(invalid)?;
        negative = true;
    }
    let value = parse_unsigned(rest).ok_or_else(invalid)?;
    Ok(if negative { -value } else { value })
}

/// Durations such as `32sec`, `1min 17sec`, `1hr 2min`, `2h 5m 1s` (units in
/// descending order, each at most once) or clock form `1:02:03` / `2:05`.
/// Returns whole seconds.
pub fn parse_duration(s: &str) -> Result<u64, String> {
    let t = s.trim();
    let invalid = || {
        format!(
            "'{t}' is not a supported duration (examples: 32sec, 1min 17sec, 1hr 2min, 1:02:03)"
        )
    };
    if t.is_empty() {
        return Err("is empty".into());
    }
    if t.contains(':') {
        let parts: Vec<&str> = t.split(':').collect();
        if !(2..=3).contains(&parts.len())
            || parts
                .iter()
                .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err(invalid());
        }
        let nums: Vec<u64> = parts
            .iter()
            .map(|p| p.parse().map_err(|_| invalid()))
            .collect::<Result<_, _>>()?;
        if nums[1..].iter().any(|n| *n >= 60) || parts[1..].iter().any(|p| p.len() != 2) {
            return Err(invalid());
        }
        return nums.iter().try_fold(0u64, |acc, n| {
            acc.checked_mul(60)
                .and_then(|v| v.checked_add(*n))
                .ok_or_else(invalid)
        });
    }

    let mut total: u64 = 0;
    let mut last_rank = usize::MAX;
    let mut rest = t;
    while !rest.is_empty() {
        let digits = rest.bytes().take_while(|b| b.is_ascii_digit()).count();
        if digits == 0 {
            return Err(invalid());
        }
        let n: u64 = rest[..digits].parse().map_err(|_| invalid())?;
        rest = rest[digits..].trim_start();
        let letters = rest.bytes().take_while(|b| b.is_ascii_alphabetic()).count();
        let unit = rest[..letters].to_ascii_lowercase();
        rest = rest[letters..].trim_start();
        let (rank, secs) = match unit.as_str() {
            "d" | "day" | "days" => (3, 86_400),
            "h" | "hr" | "hrs" | "hour" | "hours" => (2, 3_600),
            "m" | "min" | "mins" | "minute" | "minutes" => (1, 60),
            "s" | "sec" | "secs" | "second" | "seconds" => (0, 1),
            _ => return Err(invalid()),
        };
        if rank >= last_rank {
            return Err(invalid());
        }
        last_rank = rank;
        total = n
            .checked_mul(secs)
            .and_then(|v| total.checked_add(v))
            .ok_or_else(invalid)?;
    }
    Ok(total)
}

/// How slash dates are read. Never guessed per value: one format applies to
/// the whole file, chosen explicitly or detected unambiguously.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DateFormat {
    /// `2026-10-19 07:47:48`, `2026-10-19T07:47:48`, or RFC 3339 with offset.
    Ymd,
    /// `10/19/2026 07:47:48` (month first, four-digit year).
    Mdy,
    /// `19/10/2026 07:47:48` (day first, four-digit year).
    Dmy,
}

impl DateFormat {
    pub fn label(self) -> &'static str {
        match self {
            DateFormat::Ymd => "YYYY-MM-DD HH:MM:SS",
            DateFormat::Mdy => "M/D/YYYY HH:MM:SS",
            DateFormat::Dmy => "D/M/YYYY HH:MM:SS",
        }
    }
}

fn number_part(s: &str, min: usize, max: usize) -> Option<u32> {
    ((min..=max).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit()))
        .then(|| s.parse().ok())?
}

fn parse_date(s: &str, fmt: DateFormat) -> Option<NaiveDate> {
    let (sep, order) = match fmt {
        DateFormat::Ymd => ('-', [0, 1, 2]),
        DateFormat::Mdy => ('/', [2, 0, 1]),
        DateFormat::Dmy => ('/', [2, 1, 0]),
    };
    let parts: Vec<&str> = s.split(sep).collect();
    if parts.len() != 3 {
        return None;
    }
    let [yi, mi, di] = order;
    let year = number_part(parts[yi], 4, 4)?;
    NaiveDate::from_ymd_opt(
        year as i32,
        number_part(parts[mi], 1, 2)?,
        number_part(parts[di], 1, 2)?,
    )
}

/// `H:MM`, `H:MM:SS` or `H:MM:SS.fff`, with optional ` AM`/` PM`.
fn parse_time(s: &str) -> Option<NaiveTime> {
    let (clock, meridiem) = match s.rsplit_once(' ') {
        Some((c, m)) if m.eq_ignore_ascii_case("am") || m.eq_ignore_ascii_case("pm") => {
            (c.trim_end(), Some(m.eq_ignore_ascii_case("pm")))
        }
        _ => (s, None),
    };
    let parts: Vec<&str> = clock.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    let mut hour = number_part(parts[0], 1, 2)?;
    let minute = number_part(parts[1], 2, 2)?;
    let (second, nanos) = match parts.get(2) {
        None => (0, 0),
        Some(sec) => {
            let (whole, frac) = sec.split_once('.').unwrap_or((sec, ""));
            let second = number_part(whole, 2, 2)?;
            let nanos = if frac.is_empty() {
                if sec.contains('.') { return None } else { 0 }
            } else {
                let digits = number_part(frac, 1, 9)?;
                digits * 10u32.pow(9 - frac.len() as u32)
            };
            (second, nanos)
        }
    };
    if let Some(pm) = meridiem {
        if !(1..=12).contains(&hour) {
            return None;
        }
        hour = match (hour, pm) {
            (12, false) => 0,
            (12, true) => 12,
            (h, true) => h + 12,
            (h, false) => h,
        };
    }
    NaiveTime::from_hms_nano_opt(hour, minute, second, nanos)
}

/// Parse a date-time in `fmt` without applying a timezone. Values with an
/// explicit offset (RFC 3339, `Ymd` only) are returned as instants.
pub enum Stamp {
    Local(NaiveDateTime),
    Instant(DateTime<Utc>),
}

pub fn parse_stamp(s: &str, fmt: DateFormat) -> Option<Stamp> {
    let t = s.trim();
    if fmt == DateFormat::Ymd
        && (t.ends_with('Z')
            || t.ends_with('z')
            || t.get(19..).is_some_and(|tail| tail.contains(['+', '-'])))
    {
        return parse_instant(t).map(Stamp::Instant);
    }
    let split = match fmt {
        DateFormat::Ymd => t.find(['T', ' ']),
        _ => t.find(' '),
    }?;
    let date = parse_date(&t[..split], fmt)?;
    let time = parse_time(t[split + 1..].trim_start())?;
    Some(Stamp::Local(date.and_time(time)))
}

/// Parse a timestamp strictly in `fmt`; local times are read in `tz`.
pub fn parse_timestamp(s: &str, fmt: DateFormat, tz: Tz) -> Result<DateTime<Utc>, String> {
    let t = s.trim();
    if t.is_empty() {
        return Err("is empty".into());
    }
    match parse_stamp(t, fmt) {
        None => Err(format!("'{t}' is not a valid {} date-time", fmt.label())),
        Some(Stamp::Instant(i)) => Ok(i),
        Some(Stamp::Local(naive)) => match tz.from_local_datetime(&naive) {
            LocalResult::Single(dt) => Ok(dt.with_timezone(&Utc)),
            LocalResult::Ambiguous(..) => Err(format!(
                "'{t}' occurs twice in {tz} (daylight-saving change); export with a UTC offset"
            )),
            LocalResult::None => Err(format!(
                "'{t}' does not exist in {tz} (daylight-saving gap)"
            )),
        },
    }
}

/// Pick the one date format every sample fits. ISO dates never overlap with
/// slash dates; if samples fit both M/D and D/M (all days ≤ 12) the caller
/// must choose.
pub fn detect_date_format(samples: &[&str]) -> Result<(DateFormat, String), String> {
    if samples.is_empty() {
        return Ok((DateFormat::Ymd, "no timestamps to inspect".into()));
    }
    let fits = |fmt| {
        samples
            .iter()
            .filter(|s| parse_stamp(s, fmt).is_some())
            .count()
    };
    let counts = [DateFormat::Ymd, DateFormat::Mdy, DateFormat::Dmy].map(|f| (f, fits(f)));
    let full: Vec<DateFormat> = counts
        .iter()
        .filter(|(_, n)| *n == samples.len())
        .map(|(f, _)| *f)
        .collect();
    match full.as_slice() {
        [one] => Ok((*one, format!("every timestamp fits {}", one.label()))),
        [DateFormat::Mdy, DateFormat::Dmy] => Err(format!(
            "Timestamps such as '{}' fit both M/D/YYYY and D/M/YYYY. Choose the date format.",
            samples[0].trim()
        )),
        _ => {
            let (best, n) = counts.iter().max_by_key(|(_, n)| *n).copied().unwrap();
            let tied = counts.iter().filter(|(_, c)| *c == n).count() > 1;
            if n == 0 || tied {
                Err(format!(
                    "Timestamps such as '{}' are not in a supported format (YYYY-MM-DD HH:MM:SS, M/D/YYYY HH:MM:SS or D/M/YYYY HH:MM:SS).",
                    samples[0].trim()
                ))
            } else {
                Ok((
                    best,
                    format!(
                        "{n} of {} timestamps fit {}; the rest are reported per row",
                        samples.len(),
                        best.label()
                    ),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Decimal {
        Decimal::from_str(s).unwrap()
    }

    #[test]
    fn money_accepts_export_styles_and_rejects_garbage() {
        for (input, want) in [
            ("$26.00", "26"),
            ("$0.00", "0"),
            ("$(36.00)", "-36"),
            ("($36.00)", "-36"),
            ("(1.00)", "-1"),
            ("-$24.00", "-24"),
            ("$-24.00", "-24"),
            ("$1,234.50", "1234.5"),
            (" 12 ", "12"),
            (".5", "0.5"),
        ] {
            assert_eq!(parse_money(input).unwrap(), d(want), "{input}");
        }
        for bad in [
            "", "$", "$$5", "5$", "1,23.4", "1e5", "NaN", "$(36.00", "--5", "(-5)", "5.",
            "12,3456", "$26.00x",
        ] {
            assert!(parse_money(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn numbers_are_plain_and_finite() {
        assert_eq!(parse_number("29774.25").unwrap(), d("29774.25"));
        assert_eq!(parse_number("-37.63").unwrap(), d("-37.63"));
        assert_eq!(parse_number("1,000").unwrap(), d("1000"));
        for bad in ["inf", "NaN", "$5", "1e3", "", "1.2.3", "(5)"] {
            assert!(parse_number(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn durations_in_unit_and_clock_form() {
        for (input, secs) in [
            ("32sec", 32),
            ("1min 17sec", 77),
            ("1hr 2min", 3720),
            ("2min 44sec", 164),
            ("1h 2m 3s", 3723),
            ("1 day 1 sec", 86_401),
            ("1:02:03", 3723),
            ("2:05", 125),
            ("0sec", 0),
        ] {
            assert_eq!(parse_duration(input).unwrap(), secs, "{input}");
        }
        for bad in [
            "",
            "32",
            "sec",
            "17sec 1min",
            "1min 1min",
            "5 parsecs",
            "1:2",
            "1:60",
            "-5sec",
            "1.5min",
        ] {
            assert!(parse_duration(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn timestamps_are_parsed_in_exactly_the_chosen_format() {
        let ny: Tz = "America/New_York".parse().unwrap();
        let utc = |s: &str, f| parse_timestamp(s, f, ny).map(crate::domain::format_instant);
        assert_eq!(
            utc("10/19/2026 07:47:48", DateFormat::Mdy).unwrap(),
            "2026-10-19T11:47:48.000Z"
        );
        assert_eq!(
            utc("1/5/2026 7:05 PM", DateFormat::Mdy).unwrap(),
            "2026-01-06T00:05:00.000Z"
        );
        assert_eq!(
            utc("19/10/2026 07:47:48", DateFormat::Dmy).unwrap(),
            "2026-10-19T11:47:48.000Z"
        );
        assert_eq!(
            utc("2026-10-19T07:47:48.25", DateFormat::Ymd).unwrap(),
            "2026-10-19T11:47:48.250Z"
        );
        assert_eq!(
            utc("2026-10-19T07:47:48-05:00", DateFormat::Ymd).unwrap(),
            "2026-10-19T12:47:48.000Z"
        );
        // The same text is not silently re-read in another format.
        assert!(utc("19/10/2026 07:47:48", DateFormat::Mdy).is_err());
        assert!(
            utc("10/19/26 07:47:48", DateFormat::Mdy).is_err(),
            "two-digit years are rejected"
        );
        assert!(
            utc("2/30/2026 07:00:00", DateFormat::Mdy).is_err(),
            "impossible dates are rejected"
        );
        assert!(
            utc("10/19/2026", DateFormat::Mdy).is_err(),
            "a time is required"
        );
        assert!(utc("10/19/2026 13:00 PM", DateFormat::Mdy).is_err());
        assert!(
            utc("11/1/2026 1:30:00", DateFormat::Mdy)
                .unwrap_err()
                .contains("occurs twice")
        );
        assert!(
            utc("3/8/2026 2:30:00", DateFormat::Mdy)
                .unwrap_err()
                .contains("does not exist")
        );
    }

    #[test]
    fn date_format_detection_refuses_to_guess() {
        let (f, _) = detect_date_format(&["10/19/2026 07:47:48", "10/19/2026 08:00:00"]).unwrap();
        assert_eq!(f, DateFormat::Mdy);
        let (f, _) = detect_date_format(&["19/10/2026 07:47:48"]).unwrap();
        assert_eq!(f, DateFormat::Dmy);
        let (f, _) = detect_date_format(&["2026-10-19 07:47:48"]).unwrap();
        assert_eq!(f, DateFormat::Ymd);
        let err = detect_date_format(&["03/04/2026 07:47:48", "05/06/2026 07:47:48"]).unwrap_err();
        assert!(err.contains("Choose the date format"));
        assert!(detect_date_format(&["yesterday"]).is_err());
    }
}
