//! Manually invoked owner runner. OS permissions remain authoritative.
fn main() {
    std::process::exit(azrael_project_maintenance::cli::run(
        std::env::args_os().skip(1),
    ));
}
