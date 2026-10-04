fn main() {
    println!("cargo::rerun-if-changed=migrations");
    println!("cargo::rerun-if-changed=logs_migrations");
    println!("cargo::rerun-if-changed=goals_migrations");
    println!("cargo::rerun-if-changed=memory_migrations");
    println!("cargo::rerun-if-changed=queue_migrations");
    println!("cargo::rerun-if-changed=thread_history_migrations");
}
