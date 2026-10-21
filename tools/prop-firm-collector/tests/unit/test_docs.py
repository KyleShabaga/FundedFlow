"""Keep the operator docs in step with the code."""

from __future__ import annotations

from fundedflow_collector.config import load_settings
from fundedflow_collector.outcomes import OUTCOME_INFO, Outcome
from tests.conftest import PROJECT

GUIDE = PROJECT / "docs" / "USER_GUIDE.md"
README = PROJECT / "README.md"
SECTIONS = [
    "## 1. What this tool does and doesn't do",
    "## 2. Install",
    "## 3. First-time setup",
    "## 4. Add a firm",
    "## 5. Preview before fetching",
    "## 6. Fetch",
    "## 7. Manual capture",
    "## 8. Reading results",
    "## 9. When a firm blocks you",
    "## 10. Export",
    "## 11. Network and VPN guidance",
    "## 12. Troubleshooting and reset",
    "## 13. Suggested routine",
    "## 14. The desktop window",
]


def test_user_guide_has_all_sections_in_order() -> None:
    text = GUIDE.read_text(encoding="utf-8")
    positions = [text.index(heading) for heading in SECTIONS]
    assert positions == sorted(positions)


def test_user_guide_outcome_table_matches_the_code() -> None:
    text = GUIDE.read_text(encoding="utf-8")
    for outcome in Outcome:
        info = OUTCOME_INFO[outcome]
        assert f"| `{outcome.value}` | {info.category.value} | {info.meaning} | {info.action} |" in text


def test_every_outcome_has_guidance() -> None:
    assert set(OUTCOME_INFO) == set(Outcome)


def test_readme_has_good_citizen_section_and_links_the_guide() -> None:
    text = README.read_text(encoding="utf-8")
    assert "## Being a good citizen" in text
    assert "docs/USER_GUIDE.md" in text


def test_example_config_is_valid() -> None:
    settings, _ = load_settings(PROJECT / "config" / "collector.example.toml")
    assert settings.user_agent.info_url == "https://github.com/KyleShabaga/FundedFlow"
