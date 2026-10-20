//! Build 9 production operations: catalogue authoring (9.2), account selection history (9.3),
//! offer and provenance snapshots (9.4), and the populated-journal upgrade read path (9.1).

use rusqlite::Connection;

use super::authoring::{self, ClaimInput, DraftInput, OfferInput, PathInput, PhaseInput, PhaseRef, SourceInput};
use super::catalogue::{self, AccountLinkInput};
use super::offers::{self, OfferSelectionInput};
use super::tests::account_input;
use super::{accounts, trades};
use crate::catalogue::{AccountFieldSource, BillingModel, ClaimOrigin, PathStatus, PhaseKey, SourceType};
use crate::db::{catalogue_tests_seeded, migrate_with, MIGRATIONS};
use crate::error::AppError;

fn id(n: u32) -> String {
    format!("01900000-0000-7000-8000-{n:012x}")
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn source() -> SourceInput {
    SourceInput {
        source_type: SourceType::UserManual,
        url: Some("https://example.test/pricing".into()),
        descriptor: None,
        publisher: Some("Example Prop".into()),
        published_at: None,
        effective_from: None,
        effective_to: None,
        content_hash: None,
    }
}

fn draft(variant: &str, source_id: &str) -> DraftInput {
    DraftInput {
        programme_variant_id: variant.into(),
        revision_label: Some("Oct pricing".into()),
        captured_at: "2026-10-20T12:00:00Z".into(),
        effective_from: None,
        effective_to: None,
        supersedes_version_id: None,
        correction_reason: None,
        source_ids: vec![source_id.into()],
        claims: vec![ClaimInput {
            field: "offers[evaluation].salePrice".into(),
            origin: ClaimOrigin::ProviderStated,
            source_id: Some(source_id.into()),
            provider_text: Some("$0 today!".into()),
        }],
        phases: vec![PhaseInput {
            phase_key: PhaseKey::Evaluation,
            provider_label: "Phase 1".into(),
            display_order: 0,
            default_rulebook_version_id: None,
            paths: vec![PathInput {
                path_key: "standard".into(),
                provider_label: "Standard".into(),
                is_default: true,
                display_order: 0,
                record_status: PathStatus::Active,
                rulebook_version_id: None,
            }],
        }],
        offers: vec![OfferInput {
            phase: Some(PhaseRef { phase_key: PhaseKey::Evaluation, provider_label: "Phase 1".into(), path_key: Some("standard".into()) }),
            billing_model: BillingModel::OneTime,
            currency: Some("USD".into()),
            list_price: Some("150".into()),
            sale_price: Some("0".into()),
            reset_fee: None,
            activation_fee: None,
            effective_from: None,
            effective_to: None,
            source_ids: vec![source_id.into()],
        }],
    }
}

fn status(conn: &Connection, version: &str) -> String {
    conn.query_row("SELECT verification_status FROM catalogue_versions WHERE id = ?1", [version], |r| r.get(0)).unwrap()
}

fn validation_fields(e: AppError) -> Vec<String> {
    match e {
        AppError::Validation { issues, .. } => issues.into_iter().map(|i| i.field).collect(),
        other => panic!("expected validation, got {other:?}"),
    }
}

// --- 9.2 authoring ----------------------------------------------------------

#[test]
fn a_draft_version_is_authored_with_sources_claims_phases_paths_and_offers() {
    let mut conn = catalogue_tests_seeded();
    let src = authoring::create_source(&mut conn, source()).unwrap();
    assert_eq!(src.verification_status, crate::catalogue::VerificationStatus::Draft);
    let v = authoring::create_draft(&mut conn, draft(&id(0x22), &src.id)).unwrap();
    assert_eq!((v.version_number, v.source_ids.clone(), v.claims.len()), (2, vec![src.id.clone()], 1), "next version of the variant");
    assert_eq!(status(&conn, &v.id), "draft");

    let g = catalogue::load(&conn).unwrap().graph;
    let phase = g.programme_phases.iter().find(|p| p.catalogue_version_id == v.id).unwrap();
    let path = g.phase_paths.iter().find(|p| p.programme_phase_id == phase.id).unwrap();
    let offer = g.commercial_offers.iter().find(|o| o.catalogue_version_id == v.id).unwrap();
    assert_eq!((offer.programme_phase_id.as_deref(), offer.phase_path_id.as_deref()), (Some(phase.id.as_str()), Some(path.id.as_str())));
    // Known free is "0"; unknown stays absent.
    assert_eq!((offer.sale_price.as_deref(), offer.list_price.as_deref(), offer.reset_fee.clone()), (Some("0"), Some("150"), None));
    assert_eq!(offer.source_ids, std::slice::from_ref(&src.id));
}

#[test]
fn authoring_validates_and_a_failure_part_way_changes_nothing() {
    let mut conn = catalogue_tests_seeded();
    let src = authoring::create_source(&mut conn, source()).unwrap();
    let versions = count(&conn, "SELECT COUNT(*) FROM catalogue_versions");
    let phases = count(&conn, "SELECT COUNT(*) FROM programme_phases");

    let mut bad = draft(&id(0x22), &src.id);
    bad.captured_at = "monday".into();
    bad.correction_reason = Some("why".into());
    bad.offers[0].sale_price = Some("-1".into());
    bad.offers[0].currency = None;
    bad.claims[0].field = " ".into();
    assert_eq!(
        validation_fields(authoring::create_draft(&mut conn, bad).unwrap_err()),
        ["capturedAt", "supersedesVersionId", "claims[0].field", "offers[0].salePrice", "offers[0].currency"]
    );
    let mut no_reason = draft(&id(0x22), &src.id);
    no_reason.supersedes_version_id = Some(id(0x32));
    assert_eq!(validation_fields(authoring::create_draft(&mut conn, no_reason).unwrap_err()), ["correctionReason"]);
    let unknown_variant = draft("nope", &src.id);
    assert!(matches!(authoring::create_draft(&mut conn, unknown_variant), Err(AppError::Validation { .. })));
    // A correction must supersede a version of the same variant.
    let mut cross = draft(&id(0x22), &src.id);
    cross.supersedes_version_id = Some(id(0x31));
    cross.correction_reason = Some("fix".into());
    assert!(matches!(authoring::create_draft(&mut conn, cross), Err(AppError::Validation { .. })));

    // Fails after the version and phases were written: an offer naming a phase the version lacks.
    let mut late = draft(&id(0x22), &src.id);
    late.offers[0].phase.as_mut().unwrap().provider_label = "Phase 9".into();
    assert!(matches!(authoring::create_draft(&mut conn, late), Err(AppError::Validation { .. })));
    let mut unknown_source = draft(&id(0x22), &src.id);
    unknown_source.source_ids = vec!["no-such-source".into()];
    assert!(authoring::create_draft(&mut conn, unknown_source).is_err());

    assert_eq!(count(&conn, "SELECT COUNT(*) FROM catalogue_versions"), versions);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM programme_phases"), phases);
}

#[test]
fn only_a_draft_can_be_replaced() {
    let mut conn = catalogue_tests_seeded();
    let src = authoring::create_source(&mut conn, source()).unwrap();
    let v = authoring::create_draft(&mut conn, draft(&id(0x22), &src.id)).unwrap();

    let mut edit = draft(&id(0x22), &src.id);
    edit.revision_label = Some("Nov pricing".into());
    edit.offers[0].sale_price = Some("99".into());
    edit.phases[0].paths.clear();
    edit.offers[0].phase.as_mut().unwrap().path_key = None;
    let after = authoring::replace_draft(&mut conn, &v.id, edit).unwrap();
    assert_eq!((after.id.as_str(), after.revision_label.as_deref(), after.version_number), (v.id.as_str(), Some("Nov pricing"), 2));
    let g = catalogue::load(&conn).unwrap().graph;
    assert_eq!(g.commercial_offers.iter().find(|o| o.catalogue_version_id == v.id).unwrap().sale_price.as_deref(), Some("99"));
    assert_eq!(count(&conn, &format!("SELECT COUNT(*) FROM phase_paths WHERE programme_phase_id IN (SELECT id FROM programme_phases WHERE catalogue_version_id = '{}')", v.id)), 0);

    // Another variant is refused, and a version in review or reviewed cannot be edited at all.
    assert!(matches!(authoring::replace_draft(&mut conn, &v.id, draft(&id(0x21), &src.id)), Err(AppError::Validation { .. })));
    assert!(matches!(authoring::replace_draft(&mut conn, &id(0x31), draft(&id(0x21), &src.id)), Err(AppError::Validation { .. })), "needs_review");
    catalogue::transition_version(&mut conn, &v.id, "needs_review", None).unwrap();
    let in_review = authoring::replace_draft(&mut conn, &v.id, draft(&id(0x22), &src.id)).unwrap_err();
    assert!(in_review.to_string().contains("superseding"), "{in_review}");
    catalogue::transition_version(&mut conn, &v.id, "verified", Some("Kyle")).unwrap();
    assert!(authoring::replace_draft(&mut conn, &v.id, draft(&id(0x22), &src.id)).is_err());
    assert!(matches!(authoring::replace_draft(&mut conn, "nope", draft(&id(0x22), &src.id)), Err(AppError::NotFound { .. })));
}

#[test]
fn a_correction_is_a_superseding_version_and_the_original_never_changes() {
    let mut conn = catalogue_tests_seeded();
    let src = authoring::create_source(&mut conn, source()).unwrap();
    let original = authoring::create_draft(&mut conn, draft(&id(0x22), &src.id)).unwrap();
    catalogue::transition_version(&mut conn, &original.id, "needs_review", None).unwrap();
    catalogue::transition_version(&mut conn, &original.id, "verified", Some("Kyle")).unwrap();

    // Verified content is frozen, at the schema and through the commands.
    for sql in [
        format!("UPDATE catalogue_versions SET revision_label = 'edited' WHERE id = '{}'", original.id),
        format!("UPDATE commercial_offers SET sale_price_micros = 1 WHERE catalogue_version_id = '{}'", original.id),
        format!("DELETE FROM programme_phases WHERE catalogue_version_id = '{}'", original.id),
        format!("DELETE FROM catalogue_versions WHERE id = '{}'", original.id),
    ] {
        assert!(conn.execute(&sql, []).is_err(), "{sql} must be refused");
    }
    assert!(matches!(catalogue::transition_version(&mut conn, &original.id, "draft", None), Err(AppError::Conflict { .. })));

    let mut fix = draft(&id(0x22), &src.id);
    fix.supersedes_version_id = Some(original.id.clone());
    fix.correction_reason = Some("sale price was a typo".into());
    fix.offers[0].sale_price = Some("10".into());
    let correction = authoring::create_draft(&mut conn, fix).unwrap();
    assert_eq!((correction.version_number, correction.supersedes_version_id.as_deref()), (3, Some(original.id.as_str())));

    // The original is retired only once its correction is verified.
    let early = catalogue::transition_version(&mut conn, &original.id, "superseded", None);
    assert!(matches!(early, Err(AppError::Validation { .. })), "{early:?}");
    catalogue::transition_version(&mut conn, &correction.id, "needs_review", None).unwrap();
    catalogue::transition_version(&mut conn, &correction.id, "verified", Some("Kyle")).unwrap();
    catalogue::transition_version(&mut conn, &original.id, "superseded", None).unwrap();
    assert_eq!(status(&conn, &original.id), "superseded");
    let g = catalogue::load(&conn).unwrap().graph;
    let old_offer = g.commercial_offers.iter().find(|o| o.catalogue_version_id == original.id).unwrap();
    assert_eq!(old_offer.sale_price.as_deref(), Some("0"), "the original's terms are untouched");
}

#[test]
fn sources_validate_and_are_never_edited() {
    let mut conn = catalogue_tests_seeded();
    let no_origin = SourceInput { url: None, descriptor: None, ..source() };
    assert_eq!(validation_fields(authoring::create_source(&mut conn, no_origin).unwrap_err()), ["descriptor"]);
    let bad = SourceInput { url: Some("ftp://x".into()), content_hash: Some("sha256:XYZ".into()), effective_from: Some("2026-10-02T00:00:00Z".into()), effective_to: Some("2026-10-01T00:00:00Z".into()), ..source() };
    assert_eq!(validation_fields(authoring::create_source(&mut conn, bad).unwrap_err()), ["url", "effectiveTo", "contentHash"]);
    let only_descriptor = SourceInput { url: None, descriptor: Some("Discord announcement".into()), ..source() };
    assert!(authoring::create_source(&mut conn, only_descriptor).is_ok());
}

// --- 9.1 populated upgrade ---------------------------------------------------

#[test]
fn a_populated_v7_journal_reads_through_the_production_loader_after_upgrading_to_the_latest_schema() {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate_with(&mut conn, &MIGRATIONS[..7]).unwrap();
    let (_, fixture) = crate::parity::catalogue_fixture();
    crate::db::catalogue_tests_save(&conn, &fixture);
    let before_trades = count(&conn, "SELECT COUNT(*) FROM trades");

    migrate_with(&mut conn, MIGRATIONS).unwrap();
    let loaded = catalogue::load(&conn).unwrap();
    assert_eq!(loaded.graph, fixture.graph, "every catalogue record survives the upgrade and reads back identically");
    assert_eq!(loaded.sources, fixture.sources);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM trades"), before_trades);
}

// --- 9.3 account selection and history ----------------------------------------

#[test]
fn selecting_a_version_and_recording_phases_never_rewrites_history_or_trades() {
    let mut conn = catalogue_tests_seeded();
    // A legacy account with no catalogue link stays usable.
    let legacy = accounts::create(&mut conn, account_input("Legacy")).unwrap();
    assert_eq!(catalogue::get_link(&conn, &legacy.id).unwrap().catalogue_version_id, None);
    trades::create(&mut conn, super::tests::trade_input(&legacy.id)).unwrap();
    let before_trades = format!("{:?}", trades::list(&conn, &legacy.id).unwrap());

    let first = catalogue::record_phase_event(&mut conn, phase_event(&legacy.id, "Phase 1")).unwrap();
    catalogue::set_link(
        &mut conn,
        AccountLinkInput {
            account_id: legacy.id.clone(),
            programme_variant_id: Some(id(0x21)),
            catalogue_version_id: Some(id(0x31)),
            selected_phase_path_id: None,
            size_source: AccountFieldSource::UserEntered,
        },
    )
    .unwrap();
    // Choosing another version later never touches the events or trades already recorded.
    catalogue::set_link(
        &mut conn,
        AccountLinkInput {
            account_id: legacy.id.clone(),
            programme_variant_id: Some(id(0x22)),
            catalogue_version_id: Some(id(0x32)),
            selected_phase_path_id: None,
            size_source: AccountFieldSource::UserEntered,
        },
    )
    .unwrap();
    let events = catalogue::list_phase_events(&conn, &legacy.id).unwrap();
    assert_eq!(events, std::slice::from_ref(&first));
    assert_eq!(format!("{:?}", trades::list(&conn, &legacy.id).unwrap()), before_trades);
}

fn phase_event(account_id: &str, label: &str) -> catalogue::PhaseEventInput {
    catalogue::PhaseEventInput {
        account_id: account_id.into(),
        from_phase: None,
        to_phase: PhaseKey::Evaluation,
        provider_label: Some(label.into()),
        occurred_at: None,
        source: crate::catalogue::PhaseEventSource::UserEntered,
        note: None,
        correction_of_event_id: None,
        catalogue_version_id: None,
        programme_phase_id: None,
        phase_path_id: None,
    }
}

// --- 9.4 offer and provenance snapshots ---------------------------------------

fn linked_account(conn: &mut Connection) -> String {
    let a = accounts::create(conn, account_input("Eval")).unwrap();
    catalogue::set_link(
        conn,
        AccountLinkInput {
            account_id: a.id.clone(),
            programme_variant_id: Some(id(0x21)),
            catalogue_version_id: Some(id(0x31)),
            selected_phase_path_id: None,
            size_source: AccountFieldSource::UserEntered,
        },
    )
    .unwrap();
    a.id
}

fn selection(account: &str, offer: u32, promotion: Option<u32>, at: &str) -> OfferSelectionInput {
    OfferSelectionInput {
        account_id: account.into(),
        commercial_offer_id: id(offer),
        promotion_id: promotion.map(id),
        selected_at: Some(at.into()),
        note: Some(" bought on the 20th ".into()),
    }
}

#[test]
fn an_offer_selection_freezes_the_terms_and_provenance_it_was_recorded_with() {
    let mut conn = catalogue_tests_seeded();
    let account = linked_account(&mut conn);
    let sel = offers::select(&mut conn, selection(&account, 0x61, Some(0x71), "2026-10-20T12:00:00Z")).unwrap();
    assert_eq!((sel.catalogue_version_id.as_str(), sel.note.as_deref()), (id(0x31).as_str(), Some("bought on the 20th")));
    assert_eq!(sel.terms["offer"]["salePrice"], "105.2");
    assert_eq!(sel.terms["offer"]["activationFee"], serde_json::Value::Null, "unknown stays null, not 0");
    assert_eq!(sel.terms["promotion"]["code"], conn_code(&conn));
    assert!(sel.terms["sources"].as_array().is_some_and(|s| !s.is_empty()));
    assert_eq!(sel.terms["catalogueVersion"]["verificationStatus"], "needs_review");

    // Editing the (unreviewed) offer afterwards, or the promotion, cannot change what was recorded.
    conn.execute("UPDATE commercial_offers SET sale_price_micros = 1, list_price_micros = 2 WHERE id = ?1", [id(0x61)]).unwrap();
    conn.execute("UPDATE promotions SET code = 'CHANGED' WHERE id = ?1", [id(0x71)]).unwrap();
    let again = offers::list(&conn, &account).unwrap();
    assert_eq!(again, std::slice::from_ref(&sel));
    // The referenced offer and version cannot be deleted from under it, and the record is append-only.
    assert!(conn.execute("DELETE FROM commercial_offers WHERE id = ?1", [id(0x61)]).is_err());
    assert!(conn.execute("DELETE FROM catalogue_versions WHERE id = ?1", [id(0x31)]).is_err());
    assert!(conn.execute("UPDATE account_offer_selections SET note = 'x'", []).is_err());
    assert!(conn.execute("DELETE FROM account_offer_selections", []).is_err());
}

fn conn_code(conn: &Connection) -> String {
    conn.query_row("SELECT code FROM promotions WHERE id = ?1", [id(0x71)], |r| r.get::<_, Option<String>>(0)).unwrap().unwrap_or_default()
}

#[test]
fn an_offer_must_match_the_accounts_selection_and_a_promotion_must_apply_and_be_valid() {
    let mut conn = catalogue_tests_seeded();
    let bare = accounts::create(&mut conn, account_input("No catalogue")).unwrap();
    assert!(matches!(offers::select(&mut conn, selection(&bare.id, 0x61, None, "2026-10-20T12:00:00Z")), Err(AppError::Validation { .. })), "no version selected");

    let account = linked_account(&mut conn);
    let rejects = |conn: &mut Connection, input: OfferSelectionInput| match offers::select(conn, input) {
        Err(AppError::Validation { issues, .. }) => issues[0].field.clone(),
        other => panic!("expected validation error, got {other:?}"),
    };
    assert_eq!(rejects(&mut conn, selection(&account, 0x63, None, "2026-10-20T12:00:00Z")), "commercialOfferId", "an offer of another version");
    assert_eq!(rejects(&mut conn, selection(&account, 0x99, None, "2026-10-20T12:00:00Z")), "commercialOfferId");
    assert_eq!(rejects(&mut conn, selection(&account, 0x62, Some(0x71), "2026-10-20T12:00:00Z")), "promotionId", "promotion not linked to this offer");
    assert_eq!(rejects(&mut conn, selection(&account, 0x61, Some(0x99), "2026-10-20T12:00:00Z")), "promotionId");
    assert_eq!(rejects(&mut conn, selection(&account, 0x61, Some(0x71), "2027-01-02T00:00:00Z")), "promotionId", "after the promotion ended");
    assert_eq!(rejects(&mut conn, selection(&account, 0x61, None, "tomorrow")), "selectedAt");
    assert!(offers::list(&conn, &account).unwrap().is_empty(), "nothing was recorded");

    // Archived accounts stay readable but not writable.
    offers::select(&mut conn, selection(&account, 0x62, None, "2026-10-20T12:00:00Z")).unwrap();
    accounts::archive(&mut conn, &account).unwrap();
    assert_eq!(offers::list(&conn, &account).unwrap().len(), 1);
    assert!(matches!(offers::select(&mut conn, selection(&account, 0x61, None, "2026-10-20T12:00:00Z")), Err(AppError::NotFound { .. })));
}
