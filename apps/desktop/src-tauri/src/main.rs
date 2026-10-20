// Copyright (c) 2026 Kyle Shabaga. All rights reserved.
// Proprietary and source-available, not open source. See LICENSE in the repository root.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fundedflow_lib::run()
}
