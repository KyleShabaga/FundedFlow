# Template: asking a firm for permission or a machine-readable rules source

Use this when a firm's terms prohibit automated access, are unclear, or its site blocks the collector. Until the
firm answers yes in writing, keep the host on `prohibited` (or `unclear` without acknowledgement) and use manual
capture. Record the reply in `collector host terms --notes "..."`.

---

**Subject:** Permission request: low-volume reading of your public rules pages

Hello [Firm name] team,

I'm a trader using [Firm name] and I keep a personal trading journal (FundedFlow) that tracks my accounts against
your published rules. To keep my copy of the rules current, I'd like to read your public rules and help-center
pages with a small, clearly identified program rather than copying them by hand.

What it would do:

- Read only public pages (no login, no account areas), at most [75] pages per visit, one request every few
  seconds, typically [once a week].
- Identify itself honestly as `FundedFlowCollector/0.1` with a link to [info URL], and follow your robots.txt.
- Stop immediately if your site asks it to (rate limits, blocks or a robots.txt change).
- Keep the copies private on my computer as reference material. Nothing is republished.

Could you let me know whether this is acceptable under your terms of use? If you'd prefer, a machine-readable
source would be even better, for example a public JSON feed, a downloadable rules PDF, or a help-center API that
you're happy for customers to use.

If the answer is no, that's completely fine: I'll keep saving pages manually from my browser.

Thank you,
[Your name]
[Account ID or email on file, optional]
