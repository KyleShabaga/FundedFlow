// Copyright (c) 2026 Kyle Shabaga
// SPDX-License-Identifier: MIT

//! Developer CLI for Add Fake Data (Build 26.9): seeds synthetic DEMO / TEST DATA into an isolated
//! test journal that FundedFlow does not have open. Debug builds only; see docs/development/dev-tools.md.
//!
//! cargo run --example seed-demo-journal -- --data-dir <test-dir>/com.fundedflow.desktop [--preset stress]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match fundedflow_lib::dev_seed_cli(&args) {
        Ok(report) => println!("{report}"),
        Err(e) => {
            eprintln!("Seeding refused: {e}");
            std::process::exit(1);
        }
    }
}
