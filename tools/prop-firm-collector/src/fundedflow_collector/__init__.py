"""FundedFlow prop-firm collector (Build 29).

Collects public prop-firm pages as unverified evidence. It never interprets rules, logs in, or writes to the
FundedFlow app database.
"""

__version__ = "0.1.0"

#: RFC 9309 product token. It is a substring of every User-Agent the collector sends.
USER_AGENT_TOKEN = "FundedFlowCollector"  # noqa: S105 - not a secret
USER_AGENT_PRODUCT = f"{USER_AGENT_TOKEN}/0.1"
