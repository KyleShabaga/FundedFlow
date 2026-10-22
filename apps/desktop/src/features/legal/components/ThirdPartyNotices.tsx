// Settings → Privacy & legal → Third-party notices (Build 26.78). The counts come with the app; the full notices are
// loaded the first time the reader opens them, so the text stays out of the main bundle.
import { useState } from "react";

import { Disclosure, DocumentView, ErrorState, LoadingState } from "../../../design-system";
import { loadThirdPartyNotices, type NoticesPart, THIRD_PARTY_SUMMARY } from "../../../legal";

type State = { status: "idle" | "loading" | "error" } | { status: "ready"; parts: NoticesPart[] };

export function ThirdPartyNotices({ load = loadThirdPartyNotices }: { load?: () => Promise<NoticesPart[]> }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const { total, rust, npm, fonts } = THIRD_PARTY_SUMMARY;
  const fetchNotices = () => {
    setState({ status: "loading" });
    load().then(parts => setState({ status: "ready", parts }), () => setState({ status: "error" }));
  };
  return (
    <>
      <p>{`FundedFlow includes ${total} third-party components: ${rust} Rust crates, ${npm} npm packages and ${fonts} fonts. Their licences and copyright notices are below, and in THIRD_PARTY_NOTICES.txt in the folder FundedFlow is installed in.`}</p>
      <Disclosure summary="Read the third-party notices" srSummary={`(${total} components)`}
        onToggle={open => { if (open && state.status === "idle") fetchNotices(); }}>
        {state.status === "loading" && <LoadingState label="Loading the third-party notices" />}
        {state.status === "error" && (
          <ErrorState title="Couldn't load the notices" message="The notices are also in THIRD_PARTY_NOTICES.txt in the folder FundedFlow is installed in." onRetry={fetchNotices} />
        )}
        {state.status === "ready" && (
          <div className="ds-stack">
            {state.parts.map(part => <DocumentView key={part.title} preformatted headingLevel={3} title={part.title} sections={part.sections} />)}
          </div>
        )}
      </Disclosure>
    </>
  );
}
