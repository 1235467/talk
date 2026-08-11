fn main() {
    // sqlx::migrate!() embeds migration files at compile time; without this,
    // cargo does not notice new files under migrations/ and ships stale embeds.
    println!("cargo:rerun-if-changed=migrations");
}
