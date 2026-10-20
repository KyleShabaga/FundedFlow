//! Provider catalogue schema (migrations 6 and 7): the Build 9 fixture
//! round-trips through the tables, and each constraint and trigger rejects
//! what `checkCatalogueGraph` / `checkAccountCatalogueLink` would report.

use rusqlite::{params, Connection, Row};
use serde::de::DeserializeOwned;

use super::*;
use crate::catalogue::*;
use crate::domain::{micros_to_string, parse_decimal, to_micros};
use crate::parity::{catalogue_fixture, CatalogueFixture};
use crate::store::accounts;
use crate::store::tests::account_input;

const T: &str = "2026-10-19T18:00:00.000Z";

fn db() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate(&mut conn).unwrap();
    conn
}

fn micros(amount: &Option<String>) -> Option<i64> {
    amount.as_deref().map(|a| parse_decimal(a).and_then(to_micros).expect("canonical amount"))
}

fn money(m: Option<i64>) -> Option<String> {
    m.map(micros_to_string)
}

fn wire<T: DeserializeOwned>(text: String) -> T {
    serde_json::from_value(serde_json::Value::String(text)).unwrap()
}

fn json_text<T: serde::Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap()
}

fn link_sources(conn: &Connection, table: &str, owner: &str, id: &str, sources: &[String]) {
    for source in sources {
        conn.execute(&format!("INSERT INTO {table} ({owner}, source_id) VALUES (?1, ?2)"), params![id, source])
            .unwrap();
    }
}

fn source_ids(conn: &Connection, table: &str, owner: &str, id: &str) -> Vec<String> {
    conn.prepare(&format!("SELECT source_id FROM {table} WHERE {owner} = ?1 ORDER BY source_id"))
        .unwrap()
        .query_map([id], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

/// Stores every fixture record, in dependency order.
fn save(conn: &Connection, f: &CatalogueFixture) {
    let g = &f.graph;
    for p in &g.providers {
        conn.execute(
            "INSERT INTO providers (id, slug, display_name, aliases, website_url, jurisdiction, notes, record_status,
                                    created_at, updated_at, archived_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![p.id, p.slug, p.display_name, json_text(&p.aliases), p.website_url, p.jurisdiction, p.notes,
                    sql_text(&p.record_status), p.created_at, p.updated_at, p.archived_at],
        )
        .unwrap();
    }
    for x in &g.programme_families {
        conn.execute(
            "INSERT INTO programme_families (id, provider_id, slug, display_name, provider_label, description,
                                             category, record_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![x.id, x.provider_id, x.slug, x.display_name, x.provider_label, x.description,
                    sql_text(&x.category), sql_text(&x.record_status), x.created_at, x.updated_at],
        )
        .unwrap();
    }
    for v in &g.programme_variants {
        conn.execute(
            "INSERT INTO programme_variants (id, provider_id, programme_family_id, slug, display_name, provider_label,
                                             size_label, size_amount_micros, size_currency, platforms, metadata,
                                             record_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![v.id, v.provider_id, v.programme_family_id, v.slug, v.display_name, v.provider_label,
                    v.size_label, micros(&v.size_amount), v.size_currency, json_text(&v.platforms),
                    json_text(&v.metadata), sql_text(&v.record_status), v.created_at, v.updated_at],
        )
        .unwrap();
    }
    for s in &f.sources {
        conn.execute(
            "INSERT INTO catalogue_sources (id, source_type, url, descriptor, publisher, captured_at, published_at,
                                            effective_from, effective_to, content_hash, importer_version,
                                            verification_status, reviewed_by, reviewed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![s.id, sql_text(&s.source_type), s.url, s.descriptor, s.publisher, s.captured_at, s.published_at,
                    s.effective_from, s.effective_to, s.content_hash, s.importer_version,
                    sql_text(&s.verification_status), s.reviewed_by, s.reviewed_at],
        )
        .unwrap();
    }
    for v in &g.catalogue_versions {
        conn.execute(
            "INSERT INTO catalogue_versions (id, programme_variant_id, version_number, revision_label,
                                             verification_status, captured_at, effective_from, effective_to,
                                             created_by, importer_version, verified_by, verified_at,
                                             supersedes_version_id, correction_reason, content_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![v.id, v.programme_variant_id, v.version_number, v.revision_label,
                    sql_text(&v.verification_status), v.captured_at, v.effective_from, v.effective_to,
                    sql_text(&v.created_by), v.importer_version, v.verified_by, v.verified_at,
                    v.supersedes_version_id, v.correction_reason, v.content_hash],
        )
        .unwrap();
        link_sources(conn, "catalogue_version_sources", "catalogue_version_id", &v.id, &v.source_ids);
        for (i, c) in v.claims.iter().enumerate() {
            conn.execute(
                "INSERT INTO catalogue_field_claims (catalogue_version_id, position, field, origin, source_id, provider_text)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![v.id, i as i64, c.field, sql_text(&c.origin), c.source_id, c.provider_text],
            )
            .unwrap();
        }
    }
    for p in &g.programme_phases {
        conn.execute(
            "INSERT INTO programme_phases (id, catalogue_version_id, phase_key, provider_label, display_order,
                                           default_rulebook_version_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![p.id, p.catalogue_version_id, sql_text(&p.phase_key), p.provider_label, p.display_order,
                    p.default_rulebook_version_id],
        )
        .unwrap();
    }
    for p in &g.phase_paths {
        conn.execute(
            "INSERT INTO phase_paths (id, programme_phase_id, path_key, provider_label, is_default, display_order,
                                      record_status, rulebook_version_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![p.id, p.programme_phase_id, p.path_key, p.provider_label, p.is_default, p.display_order,
                    sql_text(&p.record_status), p.rulebook_version_id],
        )
        .unwrap();
    }
    for o in &g.commercial_offers {
        conn.execute(
            "INSERT INTO commercial_offers (id, catalogue_version_id, programme_phase_id, phase_path_id, billing_model,
                                            currency, list_price_micros, sale_price_micros, reset_fee_micros,
                                            activation_fee_micros, effective_from, effective_to)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![o.id, o.catalogue_version_id, o.programme_phase_id, o.phase_path_id, sql_text(&o.billing_model),
                    o.currency, micros(&o.list_price), micros(&o.sale_price), micros(&o.reset_fee),
                    micros(&o.activation_fee), o.effective_from, o.effective_to],
        )
        .unwrap();
        link_sources(conn, "commercial_offer_sources", "commercial_offer_id", &o.id, &o.source_ids);
    }
    for p in &g.promotions {
        let (kind, amount, currency, percent) = match &p.discount {
            PromotionDiscount::Amount { amount, currency } => {
                ("amount", micros(&Some(amount.clone())), Some(currency.clone()), None)
            }
            PromotionDiscount::Percent { percent } => ("percent", None, None, micros(&Some(percent.clone()))),
            PromotionDiscount::Unknown => ("unknown", None, None, None),
        };
        conn.execute(
            "INSERT INTO promotions (id, provider_id, code, provider_label, discount_kind, discount_amount_micros,
                                     discount_currency, discount_percent_micros, valid_from, valid_to,
                                     verification_status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![p.id, p.provider_id, p.code, p.provider_label, kind, amount, currency, percent, p.valid_from,
                    p.valid_to, sql_text(&p.verification_status)],
        )
        .unwrap();
        link_sources(conn, "promotion_sources", "promotion_id", &p.id, &p.source_ids);
    }
    for l in &g.promotion_offers {
        conn.execute(
            "INSERT INTO promotion_offers (promotion_id, commercial_offer_id, valid_from, valid_to)
             VALUES (?1, ?2, ?3, ?4)",
            params![l.promotion_id, l.commercial_offer_id, l.valid_from, l.valid_to],
        )
        .unwrap();
    }
    for l in &f.account_links {
        conn.execute(
            "INSERT INTO accounts (id, name, starting_balance_micros, timezone, created_at, updated_at)
             VALUES (?1, ?1, 0, 'America/New_York', ?2, ?2)",
            params![l.account_id, T],
        )
        .unwrap();
    }
    for l in &f.account_links {
        conn.execute(
            "UPDATE accounts SET provider_id = ?2, programme_variant_id = ?3, catalogue_version_id = ?4,
                    selected_phase_path_id = ?5, parent_account_id = ?6, size_source = ?7
             WHERE id = ?1",
            params![l.account_id, l.provider_id, l.programme_variant_id, l.catalogue_version_id,
                    l.selected_phase_path_id, l.parent_account_id, sql_text(&l.size_source)],
        )
        .unwrap();
    }
    for e in &f.phase_events {
        conn.execute(
            "INSERT INTO account_phase_events (id, account_id, from_phase, to_phase, provider_label, occurred_at,
                                               recorded_at, source, actor, note, correction_of_event_id,
                                               catalogue_version_id, programme_phase_id, phase_path_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![e.id, e.account_id, e.from_phase.as_ref().map(sql_text), sql_text(&e.to_phase), e.provider_label,
                    e.occurred_at, e.recorded_at, sql_text(&e.source), sql_text(&e.actor), e.note,
                    e.correction_of_event_id, e.catalogue_version_id, e.programme_phase_id, e.phase_path_id],
        )
        .unwrap();
    }
}

fn all<T>(conn: &Connection, sql: &str, map: impl Fn(&Row) -> rusqlite::Result<T>) -> Vec<T> {
    conn.prepare(sql).unwrap().query_map([], |r| map(r)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
}

/// Reads every record back into the DTOs, ordered by id like the fixture.
fn load(conn: &Connection, description: String) -> CatalogueFixture {
    let providers = all(conn, "SELECT * FROM providers ORDER BY id", |r| {
        Ok(Provider {
            id: r.get("id")?,
            slug: r.get("slug")?,
            display_name: r.get("display_name")?,
            aliases: serde_json::from_str(&r.get::<_, String>("aliases")?).unwrap(),
            website_url: r.get("website_url")?,
            jurisdiction: r.get("jurisdiction")?,
            notes: r.get("notes")?,
            record_status: wire(r.get("record_status")?),
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            archived_at: r.get("archived_at")?,
        })
    });
    let programme_families = all(conn, "SELECT * FROM programme_families ORDER BY id", |r| {
        Ok(ProgrammeFamily {
            id: r.get("id")?,
            provider_id: r.get("provider_id")?,
            slug: r.get("slug")?,
            display_name: r.get("display_name")?,
            provider_label: r.get("provider_label")?,
            description: r.get("description")?,
            category: wire(r.get("category")?),
            record_status: wire(r.get("record_status")?),
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    });
    let programme_variants = all(conn, "SELECT * FROM programme_variants ORDER BY id", |r| {
        Ok(ProgrammeVariant {
            id: r.get("id")?,
            provider_id: r.get("provider_id")?,
            programme_family_id: r.get("programme_family_id")?,
            slug: r.get("slug")?,
            display_name: r.get("display_name")?,
            provider_label: r.get("provider_label")?,
            size_label: r.get("size_label")?,
            size_amount: money(r.get("size_amount_micros")?),
            size_currency: r.get("size_currency")?,
            platforms: serde_json::from_str(&r.get::<_, String>("platforms")?).unwrap(),
            metadata: serde_json::from_str(&r.get::<_, String>("metadata")?).unwrap(),
            record_status: wire(r.get("record_status")?),
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    });
    let catalogue_versions = all(conn, "SELECT * FROM catalogue_versions ORDER BY id", |r| {
        let id: String = r.get("id")?;
        Ok(CatalogueVersion {
            source_ids: source_ids(conn, "catalogue_version_sources", "catalogue_version_id", &id),
            claims: conn
                .prepare(
                    "SELECT field, origin, source_id, provider_text FROM catalogue_field_claims
                     WHERE catalogue_version_id = ?1 ORDER BY position",
                )?
                .query_map([&id], |c| {
                    Ok(FieldClaim {
                        field: c.get(0)?,
                        origin: wire(c.get(1)?),
                        source_id: c.get(2)?,
                        provider_text: c.get(3)?,
                    })
                })?
                .collect::<rusqlite::Result<_>>()?,
            id,
            programme_variant_id: r.get("programme_variant_id")?,
            version_number: r.get("version_number")?,
            revision_label: r.get("revision_label")?,
            verification_status: wire(r.get("verification_status")?),
            captured_at: r.get("captured_at")?,
            effective_from: r.get("effective_from")?,
            effective_to: r.get("effective_to")?,
            created_by: wire(r.get("created_by")?),
            importer_version: r.get("importer_version")?,
            verified_by: r.get("verified_by")?,
            verified_at: r.get("verified_at")?,
            supersedes_version_id: r.get("supersedes_version_id")?,
            correction_reason: r.get("correction_reason")?,
            content_hash: r.get("content_hash")?,
        })
    });
    let programme_phases = all(conn, "SELECT * FROM programme_phases ORDER BY id", |r| {
        Ok(ProgrammePhase {
            id: r.get("id")?,
            catalogue_version_id: r.get("catalogue_version_id")?,
            phase_key: wire(r.get("phase_key")?),
            provider_label: r.get("provider_label")?,
            display_order: r.get("display_order")?,
            default_rulebook_version_id: r.get("default_rulebook_version_id")?,
        })
    });
    let phase_paths = all(conn, "SELECT * FROM phase_paths ORDER BY id", |r| {
        Ok(PhasePath {
            id: r.get("id")?,
            programme_phase_id: r.get("programme_phase_id")?,
            path_key: r.get("path_key")?,
            provider_label: r.get("provider_label")?,
            is_default: r.get("is_default")?,
            display_order: r.get("display_order")?,
            record_status: wire(r.get("record_status")?),
            rulebook_version_id: r.get("rulebook_version_id")?,
        })
    });
    let commercial_offers = all(conn, "SELECT * FROM commercial_offers ORDER BY id", |r| {
        let id: String = r.get("id")?;
        Ok(CommercialOffer {
            source_ids: source_ids(conn, "commercial_offer_sources", "commercial_offer_id", &id),
            id,
            catalogue_version_id: r.get("catalogue_version_id")?,
            programme_phase_id: r.get("programme_phase_id")?,
            phase_path_id: r.get("phase_path_id")?,
            billing_model: wire(r.get("billing_model")?),
            currency: r.get("currency")?,
            list_price: money(r.get("list_price_micros")?),
            sale_price: money(r.get("sale_price_micros")?),
            reset_fee: money(r.get("reset_fee_micros")?),
            activation_fee: money(r.get("activation_fee_micros")?),
            effective_from: r.get("effective_from")?,
            effective_to: r.get("effective_to")?,
        })
    });
    let promotions = all(conn, "SELECT * FROM promotions ORDER BY id", |r| {
        let id: String = r.get("id")?;
        let discount = match r.get::<_, String>("discount_kind")?.as_str() {
            "amount" => PromotionDiscount::Amount {
                amount: money(r.get("discount_amount_micros")?).unwrap(),
                currency: r.get("discount_currency")?,
            },
            "percent" => PromotionDiscount::Percent { percent: money(r.get("discount_percent_micros")?).unwrap() },
            _ => PromotionDiscount::Unknown,
        };
        Ok(Promotion {
            source_ids: source_ids(conn, "promotion_sources", "promotion_id", &id),
            id,
            provider_id: r.get("provider_id")?,
            code: r.get("code")?,
            provider_label: r.get("provider_label")?,
            discount,
            valid_from: r.get("valid_from")?,
            valid_to: r.get("valid_to")?,
            verification_status: wire(r.get("verification_status")?),
        })
    });
    let promotion_offers = all(conn, "SELECT * FROM promotion_offers ORDER BY promotion_id, commercial_offer_id", |r| {
        Ok(PromotionOffer {
            promotion_id: r.get("promotion_id")?,
            commercial_offer_id: r.get("commercial_offer_id")?,
            valid_from: r.get("valid_from")?,
            valid_to: r.get("valid_to")?,
        })
    });
    let sources = all(conn, "SELECT * FROM catalogue_sources ORDER BY id", |r| {
        Ok(SourceReference {
            id: r.get("id")?,
            source_type: wire(r.get("source_type")?),
            url: r.get("url")?,
            descriptor: r.get("descriptor")?,
            publisher: r.get("publisher")?,
            captured_at: r.get("captured_at")?,
            published_at: r.get("published_at")?,
            effective_from: r.get("effective_from")?,
            effective_to: r.get("effective_to")?,
            content_hash: r.get("content_hash")?,
            importer_version: r.get("importer_version")?,
            verification_status: wire(r.get("verification_status")?),
            reviewed_by: r.get("reviewed_by")?,
            reviewed_at: r.get("reviewed_at")?,
        })
    });
    let account_links = all(conn, "SELECT * FROM accounts ORDER BY id", |r| {
        Ok(AccountCatalogueLink {
            account_id: r.get("id")?,
            provider_id: r.get("provider_id")?,
            programme_variant_id: r.get("programme_variant_id")?,
            catalogue_version_id: r.get("catalogue_version_id")?,
            selected_phase_path_id: r.get("selected_phase_path_id")?,
            parent_account_id: r.get("parent_account_id")?,
            size_source: wire(r.get("size_source")?),
        })
    });
    let phase_events = all(conn, "SELECT * FROM account_phase_events ORDER BY id", |r| {
        Ok(AccountPhaseEvent {
            id: r.get("id")?,
            account_id: r.get("account_id")?,
            from_phase: r.get::<_, Option<String>>("from_phase")?.map(wire),
            to_phase: wire(r.get("to_phase")?),
            provider_label: r.get("provider_label")?,
            occurred_at: r.get("occurred_at")?,
            recorded_at: r.get("recorded_at")?,
            source: wire(r.get("source")?),
            actor: wire(r.get("actor")?),
            note: r.get("note")?,
            correction_of_event_id: r.get("correction_of_event_id")?,
            catalogue_version_id: r.get("catalogue_version_id")?,
            programme_phase_id: r.get("programme_phase_id")?,
            phase_path_id: r.get("phase_path_id")?,
        })
    });
    CatalogueFixture {
        description,
        graph: CatalogueGraph {
            providers,
            programme_families,
            programme_variants,
            catalogue_versions,
            programme_phases,
            phase_paths,
            commercial_offers,
            promotions,
            promotion_offers,
        },
        sources,
        account_links,
        phase_events,
    }
}

/// A database holding the whole fixture.
fn seeded() -> Connection {
    let conn = db();
    let (_, fixture) = catalogue_fixture();
    save(&conn, &fixture);
    conn
}

/// Fixture ids: `id(0x31)` is the 50K version, `id(0xa1)` a rulebook ref.
fn id(n: u32) -> String {
    format!("01900000-0000-7000-8000-{n:012x}")
}

#[track_caller]
fn rejects(conn: &Connection, sql: &str, expected: &str) {
    let err = conn.execute_batch(sql).expect_err(sql).to_string();
    assert!(err.contains(expected), "{sql}\n  failed with {err:?}, expected {expected:?}");
}

#[test]
fn the_catalogue_fixture_round_trips_through_the_database() {
    let conn = seeded();
    let (original, fixture) = catalogue_fixture();
    let loaded = load(&conn, fixture.description.clone());
    assert_eq!(serde_json::to_value(&loaded).unwrap(), original);
    let fk_problems: i64 = conn.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
    assert_eq!(fk_problems, 0);
}

#[test]
fn slugs_are_unique_per_scope_and_well_formed() {
    let conn = seeded();
    rejects(
        &conn,
        &format!("INSERT INTO providers (id, slug, display_name, record_status, created_at, updated_at)
                  VALUES ('p3', 'example-provider', 'Dup', 'unknown', '{T}', '{T}')"),
        "UNIQUE constraint failed: providers.slug",
    );
    for bad in ["Upper", "-lead", "trail-", "two--hyphens", "sp ace", ""] {
        rejects(
            &conn,
            &format!("INSERT INTO providers (id, slug, display_name, record_status, created_at, updated_at)
                      VALUES ('p3', '{bad}', 'Bad', 'unknown', '{T}', '{T}')"),
            "CHECK constraint failed",
        );
    }
    rejects(
        &conn,
        &format!("INSERT INTO programme_families (id, provider_id, slug, display_name, category, record_status,
                                                  created_at, updated_at)
                  VALUES ('f3', '{}', 'flex', 'Flex again', 'other', 'active', '{T}', '{T}')", id(1)),
        "UNIQUE constraint failed: programme_families.provider_id, programme_families.slug",
    );
    rejects(
        &conn,
        &format!("INSERT INTO providers (id, slug, display_name, record_status, created_at, updated_at)
                  VALUES ('p3', 'p3', 'Late', 'unknown', '2026-10-19 18:00:00', '{T}')"),
        "CHECK constraint failed",
    );
}

#[test]
fn a_variant_must_belong_to_its_familys_provider() {
    let conn = seeded();
    // Family 0x12 belongs to provider 2.
    rejects(
        &conn,
        &format!("INSERT INTO programme_variants (id, provider_id, programme_family_id, slug, display_name,
                                                  record_status, created_at, updated_at)
                  VALUES ('v3', '{}', '{}', '25k', '25K', 'active', '{T}', '{T}')", id(1), id(0x12)),
        "FOREIGN KEY constraint failed",
    );
    rejects(
        &conn,
        &format!("INSERT INTO programme_variants (id, provider_id, programme_family_id, slug, display_name,
                                                  size_amount_micros, record_status, created_at, updated_at)
                  VALUES ('v3', '{}', '{}', '25k', '25K', 25000000000, 'active', '{T}', '{T}')", id(1), id(0x11)),
        "CHECK constraint failed",
    );
    rejects(
        &conn,
        &format!("UPDATE programme_variants SET metadata = '[]' WHERE id = '{}'", id(0x21)),
        "CHECK constraint failed",
    );
}

#[test]
fn catalogue_version_rules() {
    let conn = seeded();
    let insert = |number: u32, status: &str, created_by: &str, extra_cols: &str, extra_vals: &str| {
        format!(
            "INSERT INTO catalogue_versions (id, programme_variant_id, version_number, verification_status,
                                             captured_at, created_by{extra_cols})
             VALUES ('cv', '{}', {number}, '{status}', '{T}', '{created_by}'{extra_vals})",
            id(0x21)
        )
    };
    let draft = |extra_cols: &str, extra_vals: &str| insert(2, "draft", "manual", extra_cols, extra_vals);
    let check = "CHECK constraint failed";
    rejects(&conn, &insert(2, "verified", "manual", "", ""), check);
    rejects(&conn, &draft(", verified_by", ", 'kyle'"), check);
    rejects(&conn, &draft(", effective_from, effective_to", ", '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'"), check);
    rejects(&conn, &insert(2, "draft", "importer", "", ""), check);
    rejects(&conn, &draft(", supersedes_version_id", &format!(", '{}'", id(0x31))), check);
    // Version 0x32 belongs to the 100K variant.
    rejects(
        &conn,
        &draft(", supersedes_version_id, correction_reason", &format!(", '{}', 'price fix'", id(0x32))),
        "FOREIGN KEY constraint failed",
    );
    rejects(&conn, &insert(1, "draft", "manual", "", ""), "UNIQUE constraint failed");
    conn.execute_batch(&draft(", supersedes_version_id, correction_reason", &format!(", '{}', 'price fix'", id(0x31))))
        .unwrap();
}

#[test]
fn reviewed_catalogue_versions_are_frozen_with_their_contents() {
    let conn = seeded();
    let v = id(0x31);
    // Invalid transitions are rejected before review too.
    rejects(&conn, &format!("UPDATE catalogue_versions SET verification_status = 'stale' WHERE id = '{v}'"), "invalid");
    conn.execute_batch(&format!(
        "UPDATE catalogue_versions SET verification_status = 'verified', verified_by = 'kyle', verified_at = '{T}'
         WHERE id = '{v}'"
    ))
    .unwrap();

    let frozen = "catalogue version is frozen";
    rejects(&conn, &format!("UPDATE catalogue_versions SET revision_label = 'edited' WHERE id = '{v}'"), frozen);
    rejects(&conn, &format!("UPDATE catalogue_versions SET verified_by = 'someone' WHERE id = '{v}'"), frozen);
    rejects(&conn, &format!("DELETE FROM catalogue_versions WHERE id = '{v}'"), frozen);
    rejects(
        &conn,
        &format!("INSERT INTO programme_phases (id, catalogue_version_id, phase_key, provider_label, display_order)
                  VALUES ('ph', '{v}', 'live_funded', 'Live', 2)"),
        frozen,
    );
    rejects(&conn, &format!("UPDATE programme_phases SET display_order = 5 WHERE id = '{}'", id(0x41)), frozen);
    rejects(&conn, &format!("UPDATE phase_paths SET provider_label = 'Daily+' WHERE id = '{}'", id(0x51)), frozen);
    rejects(&conn, &format!("DELETE FROM phase_paths WHERE id = '{}'", id(0x52)), frozen);
    rejects(&conn, &format!("UPDATE commercial_offers SET sale_price_micros = 1 WHERE id = '{}'", id(0x61)), frozen);
    rejects(&conn, &format!("DELETE FROM commercial_offer_sources WHERE commercial_offer_id = '{}'", id(0x61)), frozen);
    rejects(&conn, &format!("DELETE FROM catalogue_version_sources WHERE catalogue_version_id = '{v}'"), frozen);
    rejects(&conn, &format!("UPDATE catalogue_field_claims SET provider_text = '$1' WHERE catalogue_version_id = '{v}'"), frozen);
    // Moving a phase into the frozen version is an insert into it.
    rejects(&conn, &format!("UPDATE programme_phases SET catalogue_version_id = '{v}' WHERE id = '{}'", id(0x43)), frozen);

    // Status moves along canTransitionVerification; superseded is final.
    rejects(&conn, &format!("UPDATE catalogue_versions SET verification_status = 'draft' WHERE id = '{v}'"), "invalid");
    for status in ["stale", "verified", "superseded"] {
        conn.execute("UPDATE catalogue_versions SET verification_status = ?2 WHERE id = ?1", params![v, status])
            .unwrap();
    }
    rejects(&conn, &format!("UPDATE catalogue_versions SET verification_status = 'stale' WHERE id = '{v}'"), "invalid");

    // A draft version stays editable, and deleting it removes its contents.
    let draft = id(0x32);
    conn.execute_batch(&format!(
        "UPDATE catalogue_versions SET revision_label = 'r2' WHERE id = '{draft}';
         DELETE FROM promotion_offers WHERE commercial_offer_id = '{}';
         DELETE FROM catalogue_versions WHERE id = '{draft}';",
        id(0x63)
    ))
    .unwrap();
    let left: i64 = conn
        .query_row("SELECT count(*) FROM programme_phases WHERE catalogue_version_id = ?1", [&draft], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn sources_and_claims_need_provenance() {
    let conn = seeded();
    rejects(
        &conn,
        &format!("INSERT INTO catalogue_sources (id, source_type, captured_at, verification_status)
                  VALUES ('s', 'official', '{T}', 'draft')"),
        "CHECK constraint failed",
    );
    rejects(
        &conn,
        &format!("INSERT INTO catalogue_sources (id, source_type, url, captured_at, verification_status)
                  VALUES ('s', 'official', 'ftp://x', '{T}', 'draft')"),
        "CHECK constraint failed",
    );
    rejects(
        &conn,
        &format!("INSERT INTO catalogue_sources (id, source_type, url, captured_at, verification_status)
                  VALUES ('s', 'official', 'https://x.example/', '{T}', 'verified')"),
        "CHECK constraint failed",
    );
    rejects(
        &conn,
        &format!("INSERT INTO catalogue_sources (id, source_type, url, captured_at, verification_status, content_hash)
                  VALUES ('s', 'official', 'https://x.example/', '{T}', 'draft', 'sha256:XYZ')"),
        "CHECK constraint failed",
    );
    rejects(
        &conn,
        &format!("INSERT INTO catalogue_field_claims (catalogue_version_id, position, field, origin)
                  VALUES ('{}', 9, 'salePrice', 'provider_stated')", id(0x31)),
        "CHECK constraint failed",
    );
    rejects(
        &conn,
        &format!("DELETE FROM catalogue_sources WHERE id = '{}'", id(0x91)),
        "FOREIGN KEY constraint failed",
    );
}

#[test]
fn phases_paths_and_offers_stay_inside_their_version() {
    let conn = seeded();
    rejects(
        &conn,
        &format!("INSERT INTO phase_paths (id, programme_phase_id, path_key, provider_label, is_default, display_order,
                                           record_status)
                  VALUES ('pp', '{}', 'static', 'Static', 1, 2, 'active')", id(0x42)),
        "UNIQUE constraint failed: phase_paths.programme_phase_id",
    );
    rejects(
        &conn,
        &format!("INSERT INTO programme_phases (id, catalogue_version_id, phase_key, provider_label, display_order)
                  VALUES ('ph', '{}', 'evaluation', 'Evaluation', 3)", id(0x31)),
        "UNIQUE constraint failed",
    );
    let offer = |phase: &str, path: &str, currency: &str, list: &str| {
        format!(
            "INSERT INTO commercial_offers (id, catalogue_version_id, programme_phase_id, phase_path_id, billing_model,
                                            currency, list_price_micros)
             VALUES ('o', '{}', {phase}, {path}, 'one_time', {currency}, {list})",
            id(0x31)
        )
    };
    let q = |n: u32| format!("'{}'", id(n));
    // Phase 0x43 is in the 100K version; path 0x51 is under phase 0x42, not 0x41.
    rejects(&conn, &offer(&q(0x43), "NULL", "'USD'", "1"), "FOREIGN KEY constraint failed");
    rejects(&conn, &offer(&q(0x41), &q(0x51), "'USD'", "1"), "FOREIGN KEY constraint failed");
    rejects(&conn, &offer("NULL", &q(0x51), "'USD'", "1"), "CHECK constraint failed");
    rejects(&conn, &offer(&q(0x41), "NULL", "NULL", "1"), "CHECK constraint failed");
    rejects(&conn, &offer(&q(0x41), "NULL", "'USD'", "-1"), "CHECK constraint failed");
    conn.execute_batch(&offer(&q(0x42), &q(0x51), "'USD'", "0")).unwrap();
}

#[test]
fn promotions_follow_their_discount_kind_and_provider() {
    let conn = seeded();
    let promo = |kind: &str, amount: &str, currency: &str, percent: &str| {
        format!(
            "INSERT INTO promotions (id, provider_id, provider_label, discount_kind, discount_amount_micros,
                                     discount_currency, discount_percent_micros, verification_status)
             VALUES ('pr', '{}', 'Sale', '{kind}', {amount}, {currency}, {percent}, 'draft')",
            id(2)
        )
    };
    rejects(&conn, &promo("amount", "50000000", "NULL", "NULL"), "CHECK constraint failed");
    rejects(&conn, &promo("percent", "NULL", "NULL", "0"), "CHECK constraint failed");
    rejects(&conn, &promo("percent", "NULL", "NULL", "100000001"), "CHECK constraint failed");
    rejects(&conn, &promo("percent", "1", "'USD'", "10000000"), "CHECK constraint failed");
    rejects(&conn, &promo("unknown", "NULL", "NULL", "10000000"), "CHECK constraint failed");
    conn.execute_batch(&promo("percent", "NULL", "NULL", "100000000")).unwrap();

    // Provider 2's promotion cannot apply to provider 1's offer.
    rejects(
        &conn,
        &format!("INSERT INTO promotion_offers (promotion_id, commercial_offer_id) VALUES ('pr', '{}')", id(0x61)),
        "different providers",
    );
    // Offer 0x63 runs Oct 2026; promotion 0x71 ends 2026-12-31.
    rejects(
        &conn,
        &format!("UPDATE promotion_offers SET valid_from = '2026-11-01T00:00:00.000Z'
                  WHERE commercial_offer_id = '{}'", id(0x63)),
        "do not overlap",
    );
    rejects(
        &conn,
        &format!("INSERT INTO promotion_offers (promotion_id, commercial_offer_id, valid_from)
                  VALUES ('{}', '{}', '2027-01-01T00:00:00.000Z')", id(0x71), id(0x62)),
        "do not overlap",
    );
    rejects(
        &conn,
        &format!("INSERT INTO promotion_offers (promotion_id, commercial_offer_id) VALUES ('{}', '{}')", id(0x71), id(0x61)),
        "UNIQUE constraint failed",
    );
}

#[test]
fn account_catalogue_links_must_agree() {
    let conn = seeded();
    let link = |account: u32, set: &str| format!("UPDATE accounts SET {set} WHERE id = '{}'", id(account));
    // Account 0x83 is unlinked.
    rejects(&conn, &link(0x83, &format!("programme_variant_id = '{}'", id(0x21))), "provider");
    rejects(
        &conn,
        &link(0x83, &format!("provider_id = '{}', programme_variant_id = '{}'", id(2), id(0x21))),
        "provider",
    );
    rejects(&conn, &link(0x81, &format!("catalogue_version_id = '{}'", id(0x32))), "programme variant");
    rejects(&conn, &link(0x81, &format!("programme_variant_id = '{}'", id(0x22))), "programme variant");
    rejects(&conn, &link(0x83, &format!("selected_phase_path_id = '{}'", id(0x51))), "catalogue version");
    rejects(&conn, &link(0x81, "programme_variant_id = 'nope'"), "provider");
    rejects(&conn, &link(0x81, "size_source = 'guessed'"), "CHECK constraint failed");
    rejects(
        &conn,
        &format!("INSERT INTO accounts (id, name, starting_balance_micros, timezone, created_at, updated_at,
                                        provider_id, programme_variant_id, catalogue_version_id)
                  VALUES ('new', 'new', 0, 'UTC', '{T}', '{T}', '{}', '{}', '{}')", id(1), id(0x21), id(0x32)),
        "programme variant",
    );
    // Clearing the deepest link first is always allowed.
    conn.execute_batch(&link(0x82, "selected_phase_path_id = NULL, catalogue_version_id = NULL")).unwrap();
}

#[test]
fn phase_history_is_append_only() {
    let conn = seeded();
    let msg = "append-only";
    rejects(&conn, &format!("UPDATE account_phase_events SET note = 'x' WHERE id = '{}'", id(0xb2)), msg);
    rejects(&conn, &format!("DELETE FROM account_phase_events WHERE id = '{}'", id(0xb2)), msg);
    rejects(&conn, &format!("DELETE FROM accounts WHERE id = '{}'", id(0x81)), "FOREIGN KEY constraint failed");

    let event_to = |account: u32, to_phase: &str, cols: &str, vals: &str| {
        format!(
            "INSERT INTO account_phase_events (id, account_id, to_phase, recorded_at, source, actor{cols})
             VALUES ('e', '{}', '{to_phase}', '{T}', 'user_entered', 'user'{vals})",
            id(account)
        )
    };
    let event = |account: u32, cols: &str, vals: &str| event_to(account, "live_funded", cols, vals);
    // A correction names an event of the same account.
    rejects(&conn, &event(0x82, ", correction_of_event_id", &format!(", '{}'", id(0xb1))), "FOREIGN KEY constraint failed");
    rejects(&conn, &event(0x81, ", phase_path_id", &format!(", '{}'", id(0x51))), "CHECK constraint failed");
    rejects(
        &conn,
        &event(0x81, ", catalogue_version_id, programme_phase_id", &format!(", '{}', '{}'", id(0x32), id(0x41))),
        "FOREIGN KEY constraint failed",
    );
    rejects(
        &conn,
        &event(0x81, ", catalogue_version_id, programme_phase_id, phase_path_id",
               &format!(", '{}', '{}', '{}'", id(0x31), id(0x41), id(0x51))),
        "FOREIGN KEY constraint failed",
    );
    // `failed` is a record status, not a phase.
    rejects(&conn, &event_to(0x81, "failed", "", ""), "CHECK constraint failed");
    conn.execute_batch(&event(0x81, ", correction_of_event_id", &format!(", '{}'", id(0xb3)))).unwrap();
}

fn at_v5() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    migrate_with(&mut conn, &MIGRATIONS[..5]).unwrap();
    conn
}

#[test]
fn legacy_firms_and_programmes_map_to_the_catalogue() {
    let mut conn = at_v5();
    conn.execute_batch(
        "INSERT INTO firms (id, name, website, notes_md, created_at, updated_at, deleted_at) VALUES
            ('f1', 'Apex Trader', 'https://apex.example', 'note', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', NULL),
            ('f2', 'apex  trader!', 'apex.example', NULL, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', NULL),
            ('f3', '日本', NULL, NULL, '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z', NULL),
            ('f0', 'Gone', NULL, NULL, '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', '2025-06-01T00:00:00.000Z');
         INSERT INTO programmes (id, firm_id, name, programme_type, created_at, updated_at, deleted_at) VALUES
            ('g1', 'f1', '50K Eval', 'evaluation_to_funded', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
            ('g2', 'f1', '50k eval', 'instant_funding', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
            ('g3', 'f2', '50K Eval', 'other', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', NULL);
         INSERT INTO accounts (id, firm_id, programme_id, name, account_type, starting_balance_micros, timezone, created_at, updated_at) VALUES
            ('a1', 'f1', 'g1', 'with firm', 'sim_funded', 0, 'UTC', 'x', 'x'),
            ('a2', NULL, NULL, 'no firm', 'evaluation', 0, 'UTC', 'x', 'x');",
    )
    .unwrap();
    migrate(&mut conn).unwrap();

    let providers = all(
        &conn,
        "SELECT legacy_firm_id, slug, display_name, website_url, notes, record_status, created_at, archived_at
         FROM providers ORDER BY legacy_firm_id",
        |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?, r.get::<_, String>(5)?, r.get::<_, String>(6)?, r.get::<_, Option<String>>(7)?))
        },
    );
    let p = |firm: &str, slug: &str, name: &str, web: Option<&str>, notes: Option<&str>, status: &str, created: &str, archived: Option<&str>| {
        (firm.to_string(), slug.to_string(), name.to_string(), web.map(String::from), notes.map(String::from),
         status.to_string(), created.to_string(), archived.map(String::from))
    };
    assert_eq!(
        providers,
        [
            p("f0", "gone", "Gone", None, None, "archived", "2025-01-01T00:00:00.000Z", Some("2025-06-01T00:00:00.000Z")),
            p("f1", "apex-trader", "Apex Trader", Some("https://apex.example"), Some("note"), "unknown", "2026-01-01T00:00:00.000Z", None),
            // Same slug as f1, created later; a website without a scheme stays on the firm only.
            p("f2", "apex-trader-2", "apex  trader!", None, None, "unknown", "2026-01-03T00:00:00.000Z", None),
            // No ASCII letters; the instant is normalized to milliseconds.
            p("f3", "provider", "日本", None, None, "unknown", "2026-01-04T00:00:00.000Z", None),
        ]
    );

    let families = all(
        &conn,
        "SELECT g.legacy_programme_id, p.legacy_firm_id, g.slug, g.display_name, g.category, g.record_status
         FROM programme_families g JOIN providers p ON p.id = g.provider_id ORDER BY g.legacy_programme_id",
        |r| (0..6).map(|i| r.get::<_, String>(i)).collect::<rusqlite::Result<Vec<_>>>(),
    );
    assert_eq!(
        families,
        [
            ["g1", "f1", "50k-eval", "50K Eval", "evaluation_to_funded", "unknown"],
            ["g2", "f1", "50k-eval-2", "50k eval", "instant_funding", "archived"],
            // Family slugs are per provider.
            ["g3", "f2", "50k-eval", "50K Eval", "other", "unknown"],
        ]
    );

    let accounts = all(
        &conn,
        "SELECT a.id, p.legacy_firm_id, a.programme_variant_id, a.size_source
         FROM accounts a LEFT JOIN providers p ON p.id = a.provider_id ORDER BY a.id",
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, String>(3)?)),
    );
    let s = String::from;
    assert_eq!(accounts, [(s("a1"), Some(s("f1")), None, s("unknown")), (s("a2"), None, None, s("unknown"))]);
    let events: i64 = conn.query_row("SELECT count(*) FROM account_phase_events", [], |r| r.get(0)).unwrap();
    assert_eq!(events, 0, "no phase is inferred from account_type");
}

#[test]
fn the_account_store_maps_new_firms_to_providers() {
    let mut conn = db();
    let first = accounts::create(&mut conn, account_input("one")).unwrap();
    let second = accounts::create(&mut conn, account_input("two")).unwrap();
    let mut input = account_input("two");
    input.prop_firm = Some("Other Firm".into());
    accounts::update(&mut conn, &second.id, input).unwrap();
    let mut input = account_input("one");
    input.prop_firm = None;
    accounts::update(&mut conn, &first.id, input).unwrap();

    let rows = all(
        &conn,
        "SELECT a.name, f.name, p.slug FROM accounts a
         LEFT JOIN firms f ON f.id = a.firm_id LEFT JOIN providers p ON p.id = a.provider_id ORDER BY a.name",
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?)),
    );
    let s = String::from;
    assert_eq!(rows, [(s("one"), None, None), (s("two"), Some(s("Other Firm")), Some(s("other-firm")))]);
    let providers: i64 = conn.query_row("SELECT count(*) FROM providers", [], |r| r.get(0)).unwrap();
    assert_eq!(providers, 2, "Topstep's provider is kept after its accounts move away");
}

#[test]
fn slug_rules() {
    assert_eq!(super::steps::slug("  FundedNext — Stellar 2-Step ", "x"), "fundednext-stellar-2-step");
    assert_eq!(super::steps::slug("!!!", "provider"), "provider");
    assert_eq!(super::steps::slug(&"a-".repeat(80), "x").len(), 89);
}
