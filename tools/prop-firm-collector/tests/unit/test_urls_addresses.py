from __future__ import annotations

import pytest

from fundedflow_collector.policy.addresses import is_public_address
from fundedflow_collector.policy.urls import (
    UrlRejected,
    canonicalize,
    matches_excluded,
    normalise_host,
    resolve_link,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://WWW.Example-Firm.test/Rules#section", "https://www.example-firm.test/Rules"),
        ("https://www.example-firm.test:443/a/./b/../c", "https://www.example-firm.test/a/c"),
        ("http://www.example-firm.test:80", "http://www.example-firm.test/"),
        ("https://www.example-firm.test/%7euser/%2f", "https://www.example-firm.test/~user/%2F"),
        ("https://www.example-firm.test/a b".replace(" ", "%20"), "https://www.example-firm.test/a%20b"),
        ("https://www.example-firm.test/?b=2&a=1", "https://www.example-firm.test/?b=2&a=1"),
        ("https://bücher.example.test/regeln", "https://xn--bcher-kva.example.test/regeln"),
        ("https://www.example-firm.test/règles", "https://www.example-firm.test/r%C3%A8gles"),
    ],
)
def test_canonical_form(raw: str, expected: str) -> None:
    assert canonicalize(raw) == expected


@pytest.mark.parametrize(
    ("raw", "reason"),
    [
        ("ftp://www.example-firm.test/file", "scheme"),
        ("javascript:alert(1)", "scheme"),
        ("file:///C:/Windows/win.ini", "scheme"),
        ("https://user:pass@www.example-firm.test/", "credentials"),
        ("https://www.example-firm.test@evil.test/", "credentials"),
        ("https://www.example-firm.test:8080/", "port"),
        ("https://www.example-firm.test:22/", "port"),
        ("https://127.0.0.1/", "IP-literal"),
        ("https://[::1]/", "IP-literal"),
        ("https://2130706433/", "IP-literal"),
        ("https://0x7f.1/", "IP-literal"),
        ("https://169.254.169.254/latest/meta-data/", "IP-literal"),
        ("https://localhost/", "invalid host"),
        ("https://www.example-firm.test/a\\b", "control"),
        ("https://www.example-firm.test/\x00", "control"),
        ("https://www.example-firm.test/" + "a" * 2100, "too long"),
        ("https:///nohost", "no host"),
    ],
)
def test_unsafe_urls_are_rejected(raw: str, reason: str) -> None:
    with pytest.raises(UrlRejected) as info:
        canonicalize(raw)
    assert reason.lower() in info.value.reason.lower()


def test_duplicate_spellings_collapse_to_one_url() -> None:
    variants = [
        "https://www.example-firm.test/rules",
        "HTTPS://WWW.EXAMPLE-FIRM.TEST/rules",
        "https://www.example-firm.test:443/rules#top",
        "https://www.example-firm.test/./rules",
        "https://www.example-firm.test/x/../rules",
    ]
    assert {canonicalize(v) for v in variants} == {"https://www.example-firm.test/rules"}


def test_resolve_link_and_fragments() -> None:
    assert resolve_link("https://www.example-firm.test/a/b", "../faq") == "https://www.example-firm.test/faq"
    assert resolve_link("https://www.example-firm.test/a", "//help.example-firm.test/x") == (
        "https://help.example-firm.test/x"
    )
    with pytest.raises(UrlRejected):
        resolve_link("https://www.example-firm.test/a", "#top")


def test_subdomains_are_not_implied_by_host_normalisation() -> None:
    assert normalise_host("Help.Example-Firm.TEST.") == "help.example-firm.test"
    assert normalise_host("help.example-firm.test") != normalise_host("example-firm.test")


def test_excluded_path_globs() -> None:
    patterns = ["/blog/*", "/login*"]
    assert matches_excluded("https://www.example-firm.test/blog/news", patterns) == "/blog/*"
    assert matches_excluded("https://www.example-firm.test/login?next=/", patterns) == "/login*"
    assert matches_excluded("https://www.example-firm.test/rules", patterns) is None


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
        "224.0.0.1", "255.255.255.255", "192.0.2.10", "198.18.0.1", "::1", "fe80::1", "fc00::1", "ff02::1", "::",
        "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2002:7f00:0001::1", "2001:0:4136:e378:8000:63bf:80ff:fffe",
        "64:ff9b::7f00:1", "64:ff9b:1::1", "not-an-ip",
    ],
)
def test_non_public_addresses_are_refused(address: str) -> None:
    assert not is_public_address(address)


@pytest.mark.parametrize("address", ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"])
def test_public_addresses_are_allowed(address: str) -> None:
    assert is_public_address(address)
