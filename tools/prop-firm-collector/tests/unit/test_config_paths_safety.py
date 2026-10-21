from __future__ import annotations

import os
from pathlib import Path

import pytest

from fundedflow_collector.config import ConfigError, Settings, load_settings
from fundedflow_collector.net.client import UserAgentNotConfigured, build_user_agent
from fundedflow_collector.paths import AppDatabaseGuardError, guard_against_app_database, resolve_paths
from fundedflow_collector.safety import BANNED_PACKAGES, banned_in_lockfile, banned_installed

PROJECT = Path(__file__).resolve().parents[2]


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "collector.toml"
    path.write_text(text, encoding="utf-8")
    return path


def test_defaults_match_the_card() -> None:
    s = Settings()
    assert s.pacing.min_delay_seconds == 2.0
    assert s.pacing.unclear_terms_delay_seconds == 5.0
    assert s.budget.fetches_per_firm_run == 75
    assert s.browser.enabled == "auto"
    assert s.browser.min_text_chars == 300
    assert s.raw.retain is False
    assert s.raw.retention_days == 90
    assert s.pdf.timeout_seconds == 30
    assert s.pdf.max_pages == 50
    assert s.limits.max_html_bytes == 5 * 1024 * 1024


@pytest.mark.parametrize(
    "text",
    [
        "[pacing]\nmin_delay_seconds = 0.5\n",
        "[pacing]\nunclear_terms_delay_seconds = 2\n",
        "[budget]\nfetches_per_firm_run = 301\n",
        "[budget]\nrun_deadline_minutes = 0\n",
        "[limits]\nmax_depth = 9\n",
        "[pacing]\njitter_ms = 2000\n",
    ],
)
def test_floors_and_ceilings_are_errors_not_silent_clamps(tmp_path: Path, text: str) -> None:
    with pytest.raises(ConfigError):
        load_settings(write(tmp_path, text))


@pytest.mark.parametrize(
    "text",
    [
        'proxy = "http://127.0.0.1:8080"\n',
        "stealth = true\n",
        '[user_agent]\noverride = "Mozilla/5.0 (Windows NT 10.0) Chrome/130"\n',
        "[network]\nallow_private_addresses = true\n",
        "[robots]\nignore = true\n",
        '[http]\ncookies = "session=abc"\n',
        "[limits]\nallowed_ports = [8080]\n",
    ],
)
def test_no_setting_can_enable_evasion_or_bypass(tmp_path: Path, text: str) -> None:
    with pytest.raises(ConfigError):
        load_settings(write(tmp_path, text))


def test_info_url_must_be_https_and_user_agent_is_honest(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        load_settings(write(tmp_path, '[user_agent]\ninfo_url = "http://example.invalid/x"\n'))
    settings, digest = load_settings(write(tmp_path, '[user_agent]\ninfo_url = "https://example.invalid/ffc"\n'
                                                     'contact = "ops@example.invalid"\n'))
    assert len(digest) == 64
    ua = build_user_agent(settings)
    assert ua == "Mozilla/5.0 (compatible; FundedFlowCollector/0.1; +https://example.invalid/ffc; ops@example.invalid)"
    assert "FundedFlowCollector" in ua and "Chrome" not in ua and "Safari" not in ua


def test_live_fetching_requires_an_info_url() -> None:
    with pytest.raises(UserAgentNotConfigured):
        build_user_agent(Settings())


def test_missing_config_file_uses_defaults(tmp_path: Path) -> None:
    settings, _ = load_settings(tmp_path / "absent.toml")
    assert settings == Settings()


def test_app_database_guard(isolated_env: Path) -> None:
    app_dir = Path(os.environ["APPDATA"]) / "com.fundedflow.desktop"
    for path in (app_dir / "fundedflow.db", app_dir / "collector.db", Path("C:/anywhere/fundedflow.db"),
                 Path("D:/x/com.fundedflow.desktop/y/collector.db")):
        with pytest.raises(AppDatabaseGuardError):
            guard_against_app_database(path)
    guard_against_app_database(isolated_env / "collector" / "collector.db")
    with pytest.raises(AppDatabaseGuardError):
        resolve_paths(app_dir)


def test_default_data_dir_is_not_the_app_folder(isolated_env: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FFC_DATA_DIR")
    paths = resolve_paths(None)
    assert paths.data_dir == (Path(os.environ["LOCALAPPDATA"]) / "FundedFlow" / "Collector").resolve()
    assert "com.fundedflow.desktop" not in str(paths.db)


def test_banned_dependencies_absent_from_lockfile_and_environment() -> None:
    assert banned_in_lockfile(PROJECT / "uv.lock") == []
    assert banned_installed() == []


def test_banned_lockfile_check_detects_a_banned_package(tmp_path: Path) -> None:
    lock = tmp_path / "uv.lock"
    lock.write_text('version = 1\n[[package]]\nname = "Crawl4AI"\nversion = "0.7.0"\n'
                    '[[package]]\nname = "curl_cffi"\nversion = "0.7"\n', encoding="utf-8")
    assert banned_in_lockfile(lock) == ["crawl4ai", "curl-cffi"]
    assert {"crawl4ai", "playwright-stealth", "undetected-chromedriver", "cloudscraper", "curl-cffi",
            "pymupdf"} <= set(BANNED_PACKAGES)


def test_http_stack_is_pinned_to_the_tested_versions() -> None:
    from importlib import metadata

    assert metadata.version("httpx") == "0.28.1"
    assert metadata.version("httpcore") == "1.0.9"
    text = (PROJECT / "pyproject.toml").read_text(encoding="utf-8")
    assert '"httpx==0.28.1"' in text and '"httpcore==1.0.9"' in text
