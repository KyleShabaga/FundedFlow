"""Regenerates the synthetic comparison-publisher practice site and captures (Build 29.25).

Run from tools/prop-firm-collector: `uv run python tests/make_directory_fixtures.py`. The hosts are the four real
publishers' names, because adapters and presets are keyed by host, but every page is invented: fictional firms
(Northwind Futures, Contoso Funding, Fabrikam Traders, Tailspin Capital), invented numbers, and layouts that only
imitate the kind of page each adapter reads. No real publisher content is ever committed.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "examples"
SITE = ROOT / "directory-site"
CAPTURES = ROOT / "captures" / "directory"

BANNER = (
    "<!-- SYNTHETIC FIXTURE for FundedFlow collector tests and practice runs. This is NOT content from {host}: "
    "the firms (Northwind Futures, Contoso Funding, Fabrikam Traders, Tailspin Capital) and every number are "
    "invented. Only the page layout imitates the kind of page the adapter reads. -->"
)
FILLER = (
    "<p>Synthetic practice page. The figures below are invented for software tests and describe no real firm. "
    "Always read a firm's own rules before trading; comparison sites can be out of date or wrong.</p>"
)


def page(host: str, title: str, body: str, *, head: str = "") -> str:
    return (
        f'<!doctype html>\n{BANNER.format(host=host)}\n<html lang="en"><head><meta charset="utf-8">'
        f'<title>{title}</title>{head}</head>\n<body>\n<nav><a href="/">Home</a></nav>\n<main>\n{body}\n{FILLER}\n'
        '</main>\n<footer><a href="/privacy-policy">Privacy</a></footer>\n</body></html>\n'
    )


def write(relative: str, text: str, root: Path = SITE) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


# ------------------------------------------------------------------ OnlyPropFirms (synthetic)
H = "onlypropfirms.com"
write(f"{H}/robots.txt", "# Synthetic robots.txt for the practice site.\nUser-agent: *\nDisallow: /wp-admin/\n")
write(
    f"{H}/prop-firm-comparison.html",
    page(
        H,
        "Prop firm comparison (synthetic)",
        """<h1>Prop Firm Comparison</h1>
<table>
<thead><tr><th>Prop Firm</th><th>Program</th><th>Account Size</th><th>Profit Target</th><th>Max Drawdown</th>
<th>Drawdown Type</th><th>Daily Loss Limit</th><th>Consistency Rule</th><th>Min. Trading Days</th><th>Price</th>
<th>Rating</th><th>Deal</th></tr></thead>
<tbody>
<tr><td rowspan="2"><a href="/prop-firms/northwind-futures">Northwind Futures</a></td><td>Rally</td><td>$50K</td>
<td>$3,000</td><td>$2,500</td><td>EOD trailing</td><td>$1,100</td><td>40%</td><td>5</td><td>$165</td><td>4.8</td>
<td><a href="/go/northwind?ref=opf">Use code SAVE</a></td></tr>
<tr><td>Rally</td><td>$100K</td><td>$6,000</td><td>$3,000</td><td>EOD trailing</td><td>None</td><td>40%</td><td>5</td>
<td>$265</td><td>4.8</td><td>-</td></tr>
<tr><td><a href="/prop-firms/contoso-funding">Contoso Funding</a></td><td>Core</td><td>$50K</td><td>6%</td><td>4%</td>
<td>Static</td><td>2%</td><td>No</td><td>—</td><td>$99</td><td>4.1</td><td>-</td></tr>
<tr><td><a href="/prop-firms/fabrikam-traders">Fabrikam Traders</a></td><td>Flex</td><td>$25K–$150K</td>
<td>6%–8%</td><td>See rules</td><td>Trailing</td><td>N/A</td><td>?</td><td>3</td><td>$49</td><td>3.9</td><td>-</td></tr>
</tbody></table>
<p><a href="/prop-firm-comparison?page=2">Next page</a> · <a href="/prop-firm-comparison?sort=price">Sort by price</a>
· <a href="https://www.northwind-futures.test/">Northwind official site</a></p>""",
    ),
)
write(
    f"{H}/prop-firm-comparison__page=2.html",
    page(
        H,
        "Prop firm comparison, page 2 (synthetic)",
        """<h1>Prop Firm Comparison</h1>
<table>
<thead><tr><th>Prop Firm</th><th>Program</th><th>Account Size</th><th>Profit Target</th><th>Max Drawdown</th>
<th>Drawdown Type</th><th>Daily Loss Limit</th><th>Consistency Rule</th><th>Min. Trading Days</th><th>Price</th>
<th>Rating</th><th>Deal</th></tr></thead>
<tbody>
<tr><td><a href="/prop-firms/tailspin-capital">Tailspin Capital</a></td><td>Step</td><td>€100k</td><td>10%</td>
<td>10%</td><td>Static</td><td>5%</td><td>No</td><td>4 days</td><td>€399</td><td>4.0</td><td>-</td></tr>
</tbody></table>
<p><a href="/prop-firm-comparison">Previous page</a></p>""",
    ),
)
write(
    f"{H}/prop-firms.html",
    page(
        H,
        "True cost to funding (synthetic)",
        """<h1>True Cost to Funding</h1>
<table>
<tr><th>Prop Firm</th><th>Account</th><th>Evaluation Cost</th><th>Activation Fee</th><th>True Cost to Funding</th>
<th>Discount Code</th></tr>
<tr><td><a href="/prop-firms/northwind-futures">Northwind Futures</a></td><td>50K Rally</td><td>$165</td><td>$0</td>
<td>$190</td><td>SAVE</td></tr>
<tr><td><a href="/prop-firms/contoso-funding">Contoso Funding</a></td><td>50K Core</td><td>$99</td><td>$140</td>
<td>$260</td><td>-</td></tr>
</table>""",
    ),
)
write(
    f"{H}/prop-firm-starting-costs.html",
    page(
        H,
        "Starting costs (synthetic)",
        """<h1>Prop Firm Starting Costs</h1>
<table><tr><th>Prop Firm</th><th>Cheapest Account</th><th>Starting Cost</th><th>Deal</th></tr>
<tr><td>Fabrikam Traders</td><td>25K Flex</td><td>$49</td><td>-</td></tr></table>""",
    ),
)
write(
    f"{H}/largest-drawdown.html",
    (
        f'<!doctype html>\n{BANNER.format(host=H)}\n<html><head><meta charset="utf-8"><title>{{title}}</title></head>'
        '<body><div id="__next"></div><noscript>Please enable JavaScript to see the comparison.</noscript>'
        "<p>{vendor_count} prop firms compared</p></body></html>\n"
    ),
)
write(
    f"{H}/prop-firms/northwind-futures.html",
    page(
        H,
        "Northwind Futures (synthetic)",
        """<h1>Northwind Futures</h1>
<p><a href="https://www.northwind-futures.test/rules?aff=opf">Official website</a> ·
<a href="/go/northwind">Get the deal</a></p>
<h2>Rally</h2>
<table>
<tr><th>Account Size</th><th>Phase</th><th>Profit Target</th><th>Max Drawdown</th><th>Drawdown Type</th>
<th>Daily Loss Limit</th><th>Consistency Rule</th><th>Min. Trading Days</th><th>Payout Split</th><th>Price</th></tr>
<tr><td>$50K</td><td>Evaluation</td><td>$3,000</td><td>$2,500</td><td>EOD trailing</td><td>$1,100</td><td>40%</td>
<td>5</td><td>—</td><td>$165</td></tr>
<tr><td>$50K</td><td>Funded</td><td>N/A</td><td>$2,500</td><td>EOD trailing</td><td>$1,100</td><td>40%</td>
<td>8</td><td>90%</td><td>—</td></tr>
</table>""",
    ),
)
write(
    f"{H}/prop-firms/contoso-funding.html",
    page(
        H,
        "Contoso Funding (synthetic)",
        """<h1>Contoso Funding</h1>
<h2>Core</h2>
<table>
<tr><th>Account Size</th><th>Profit Target</th><th>Max Drawdown</th><th>Daily Loss Limit</th><th>Platform</th></tr>
<tr><td>$50K</td><td>6%</td><td>4%</td><td>2%</td><td>Synthetic platform</td></tr>
</table>""",
    ),
)

# ------------------------------------------------------------------ Trader's Second Brain (synthetic)
H = "traderssecondbrain.com"
write(
    f"{H}/robots.txt",
    "# Synthetic robots.txt for the practice site.\nUser-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /go/\n",
)
write(
    f"{H}/prop-firms.html",
    page(
        H,
        "Prop firms directory (synthetic)",
        """<h1>Prop firms</h1>
<table>
<thead><tr><th>Rank</th><th>Firm / program</th><th>TSB Fit</th><th>Target</th><th>Daily loss</th><th>Drawdown</th>
<th>Payout</th><th>Price / offer</th><th>Action</th></tr></thead>
<tbody>
<tr><td>1</td><td><a href="/prop-firm/northwind-futures">Northwind Futures</a> <span>Rally 50K</span></td><td>92</td>
<td>$3,000</td><td>$1,000 Verify the exact configuration before checkout</td><td>$2,500 trailing (EOD)</td>
<td>Bi-weekly after 8 days</td><td>$165 <a href="/go/prop-firm/northwind?placement=table">Offer</a></td>
<td><a href="/track-prop/northwind?program=rally&amp;size=50k">Track</a></td></tr>
<tr><td>2</td><td><a href="/prop-firm/contoso">Contoso</a> <span>Core 50K</span></td><td>88</td><td>6%</td>
<td>2%</td><td>4% static</td><td>See programme rules</td><td>Price not verified</td><td>-</td></tr>
<tr><td>3</td><td><a href="/prop-firm/fabrikam-traders-llc">Fabrikam Traders LLC</a> <span>Flex 25K</span></td>
<td>71</td><td>8%</td><td>—</td><td>5</td><td>Monthly</td><td>-</td><td>-</td></tr>
</tbody></table>
<p><a href="/prop-firms?page=2">More firms</a> · <a href="/prop-firms/data.json">Dataset</a> ·
<a href="/api/social-proof.php">Social</a></p>""",
    ),
)
write(
    f"{H}/prop-firms__page=2.html",
    page(H, "Prop firms directory, page 2 (synthetic)", "<h1>Prop firms</h1><p>No firms match these filters.</p>"),
)
write(
    f"{H}/prop-firm/northwind-futures.html",
    page(
        H,
        "Northwind Futures programmes (synthetic)",
        """<h1>Northwind Futures</h1>
<section id="program-details"><h2>Program details</h2>
<table>
<tr><th>Program</th><th>Account size</th><th>Phase</th><th>Market</th><th>Profit target</th><th>Daily loss</th>
<th>Max drawdown</th><th>Drawdown type</th><th>Consistency</th><th>Min. days</th><th>Payout split</th>
<th>Payout frequency</th><th>Price</th></tr>
<tr><td>Rally</td><td>$50K</td><td>Evaluation</td><td>Futures</td><td>$3,000</td><td>$1,000</td><td>$2,500</td>
<td>Trailing (end of day)</td><td>40%</td><td>5</td><td>—</td><td>—</td><td>$165</td></tr>
<tr><td>Rally</td><td>$50K</td><td>Sim funded</td><td>Futures</td><td>n/a</td><td>$1,000</td><td>$2,500</td>
<td>Trailing (end of day)</td><td>40%</td><td>8</td><td>90/10</td><td>Bi-weekly</td><td>—</td></tr>
</table></section>
<h2>Sources</h2><ul><li><a href="https://www.northwind-futures.test/rules?utm_source=tsb">Northwind rules page</a></li></ul>
<p><a href="/guides/northwind-futures-review">Read the rule guide</a></p>""",
    ),
)
write(
    f"{H}/prop-firm/contoso.html",
    page(H, "Contoso (synthetic)", '<h1>Contoso</h1><section id="program-details"><p>Coming soon.</p></section>'),
)
write(
    f"{H}/guides/northwind-futures-review.html",
    page(
        H,
        "Northwind Futures review (synthetic)",
        """<h1>Northwind Futures review</h1>
<h2>Rally</h2><h3>Evaluation</h3>
<table><tr><th>Rule</th><th>Value</th></tr>
<tr><td>Account size</td><td>$50K</td></tr><tr><td>Profit target</td><td>$3,000</td></tr>
<tr><td>Daily loss limit</td><td>$1,000</td></tr><tr><td>Max drawdown</td><td>$2,500 trailing</td></tr>
<tr><td>Trading platforms</td><td>Synthetic platform</td></tr></table>""",
    ),
)

# ------------------------------------------------------------------ Prop Firm Match, futures (synthetic captures)
H = "propfirmmatch.com"
write(
    "propfirmmatch-futures-challenges.html",
    page(
        H,
        "Futures prop firm challenges (synthetic capture)",
        """<h1>Futures prop firm challenges</h1>
<table>
<tr><th>Firm</th><th>Program</th><th>Steps</th><th>Account Size</th><th>Phase</th><th>Profit Target</th>
<th>Daily Loss</th><th>Max Loss</th><th>Drawdown Type</th><th>Min. Trading Days</th><th>Payout Split</th><th>Price</th>
<th>Discount</th><th>Rating</th></tr>
<tr><td><a href="/futures/prop-firms/northwind-futures">Northwind Futures</a></td><td>Rally</td><td>1 Step</td>
<td>$50K</td><td>Phase 1</td><td>$3,000</td><td>$1,100</td><td>$2,500</td><td>Trailing EOD</td><td>5</td><td>90%</td>
<td>$165</td><td>20% off</td><td>4.7</td></tr>
<tr><td><a href="/futures/prop-firms/northwind-futures">Northwind Futures</a></td><td>Rally</td><td>1 Step</td>
<td>$50K</td><td>Funded</td><td>—</td><td>$1,100</td><td>$2,500</td><td>Trailing EOD</td><td>8</td><td>90%</td><td>—</td>
<td>-</td><td>4.7</td></tr>
<tr><td><a href="/futures/prop-firms/tailspin-capital">Tailspin Capital</a></td><td>Step</td><td>2 Steps</td>
<td>€100k</td><td>Phase 2</td><td>5%</td><td>5%</td><td>10%</td><td>Static</td><td>4</td><td>80%</td><td>€399</td><td>-</td>
<td>4.2</td></tr>
</table>
<p><a href="/futures/prop-firm-challenges?page=2">Next</a> ·
<a href="/futures/prop-firm-challenges?sort=price&amp;extendedFilters=x">Cheapest first</a></p>""",
    ),
    CAPTURES,
)
write(
    "propfirmmatch-futures-challenges-changed.html",
    page(
        H,
        "Futures prop firm challenges (synthetic capture, redesigned layout)",
        """<h1>Futures prop firm challenges</h1>
<table>
<tr><th>Firm</th><th>Program</th><th>Size</th><th>Goal</th><th>Loss limits</th></tr>
<tr><td>Northwind Futures</td><td>Rally</td><td>$50K</td><td>$3,000</td><td>$1,100 / $2,500</td></tr>
</table>""",
    ),
    CAPTURES,
)

# ------------------------------------------------------------------ Prop Firm Gorilla (synthetic)
H = "propfirmgorilla.com"
write(
    f"{H}/robots.txt",
    "# Synthetic robots.txt for the practice site.\nUser-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n",
)
write(
    f"{H}/firms.html",
    (
        f'<!doctype html>\n{BANNER.format(host=H)}\n<html><head><meta charset="utf-8"><title>Firms</title></head>'
        '<body><h1>Prop firms</h1><div id="__next"></div><script src="/static/firms.js"></script></body></html>\n'
    ),
)
write(
    f"{H}/firms/northwind-futures.html",
    page(
        H,
        "Northwind Futures (synthetic)",
        """<h1>Northwind Futures</h1>
<h2>Plan: 50K Rally</h2>
<h3>Evaluation rules</h3>
<table><tr><th>Profit target</th><td>$3,000</td></tr><tr><th>Daily loss limit</th><td>$1,100</td></tr>
<tr><th>Max drawdown</th><td>$2,500</td></tr><tr><th>Drawdown type</th><td>Trailing, end of day</td></tr>
<tr><th>Minimum trading days</th><td>5</td></tr><tr><th>Platforms</th><td>Synthetic platform</td></tr></table>
<h3>Funded rules</h3>
<table><tr><th>Daily loss limit</th><td>$1,100</td></tr><tr><th>Max drawdown</th><td>$2,500</td></tr>
<tr><th>Consistency rule</th><td>40%</td></tr><tr><th>Payout split</th><td>Up to 90%</td></tr>
<tr><th>Payout frequency</th><td>Every 8 trading days</td></tr></table>
<h2>Matchup</h2><p><a href="/matchup?firms=northwind,contoso">Compare</a></p>""",
    ),
)
write(
    "propfirmgorilla-firms-rendered.html",
    page(
        H,
        "Prop firms (synthetic capture of the rendered list)",
        """<h1>Prop firms</h1>
<article><h3><a href="/firms/northwind-futures">Northwind Futures</a></h3></article>
<article><h3><a href="/firms/contoso-funding">Contoso Funding</a></h3></article>""",
    ),
    CAPTURES,
)

# small profiles so the practice run has no missing pages
for host, path, name in (
    ("onlypropfirms.com", "prop-firms/fabrikam-traders.html", "Fabrikam Traders"),
    ("onlypropfirms.com", "prop-firms/tailspin-capital.html", "Tailspin Capital"),
    ("traderssecondbrain.com", "prop-firm/fabrikam-traders-llc.html", "Fabrikam Traders LLC"),
):
    if host.startswith("trader"):
        body = (
            f'<h1>{name}</h1><section id="program-details"><table><tr><th>Program</th><th>Account size</th>'
            "<th>Profit target</th><th>Daily loss</th></tr><tr><td>Flex</td><td>$25K</td><td>8%</td><td>—</td></tr>"
            "</table></section>"
        )
    else:
        body = (
            f"<h1>{name}</h1><h2>Flex</h2><table><tr><th>Account Size</th><th>Profit Target</th>"
            "<th>Max Drawdown</th></tr><tr><td>$25K</td><td>6%</td><td>$1,500 trailing</td></tr></table>"
        )
    write(f"{host}/{path}", page(host, f"{name} (synthetic)", body))

# the client-rendered Gorilla list (filled by a script, for the browser test) and a second Gorilla firm page
write(
    "propfirmgorilla.com/static/firms.js",
    "// SYNTHETIC FIXTURE: fills the practice firm list in the browser, like a client-rendered directory page.\n"
    "// The firms are invented. Not code or content from propfirmgorilla.com.\n"
    'document.getElementById("__next").innerHTML =\n'
    "  '<article><h3><a href=\"/firms/northwind-futures\">Northwind Futures</a></h3></article>' +\n"
    "  '<article><h3><a href=\"/firms/contoso-funding\">Contoso Funding</a></h3></article>';\n",
)
write(
    "propfirmgorilla.com/firms/contoso-funding.html",
    page(
        "propfirmgorilla.com",
        "Contoso Funding (synthetic)",
        """<h1>Contoso Funding</h1>
<h2>Plan: 50K Core</h2>
<h3>Evaluation rules</h3>
<table><tr><th>Profit target</th><td>6%</td></tr><tr><th>Daily loss limit</th><td>2%</td></tr>
<tr><th>Max drawdown</th><td>4%</td></tr><tr><th>Drawdown type</th><td>Static</td></tr></table>
""",
    ),
)
