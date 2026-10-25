//! Thin native entry: helper dispatch, app-server, and per-window stdio proxy.
#![recursion_limit = "256"]

#[path = "../main.rs"]
mod entry;

fn main() -> anyhow::Result<()> {
    entry::azrael_main()
}
