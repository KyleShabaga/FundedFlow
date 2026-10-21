"""Build 29.25: comparison publishers (third-party prop-firm directory sites) and their unverified observations.

A publisher is never a prop firm and never a first-party rule source. Its pages are fetched through the Build 29
pipeline unchanged (allowlist, terms gate, robots.txt, pacing, circuit breaker, budget); this package only decides
which of a publisher's own pages are in scope and turns stored page versions into field-level observations with
full provenance. Nothing here approves, interprets or publishes a rule.
"""
