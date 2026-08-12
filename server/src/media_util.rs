//! Text-level media transforms: the single place that knows how base64 data
//! URLs become files under TALK_MEDIA_DIR (and back, for exports), plus the
//! orphan-file sweep. Row `data` JSON, kv values and preset modules are all
//! treated as opaque text, so nested copies inside save snapshots are handled
//! without per-field knowledge.

use std::{
    collections::HashSet,
    path::Path,
    sync::LazyLock,
};

use base64::Engine;
use regex::Regex;
use sqlx::SqlitePool;

use crate::error::AppResult;

pub const MEDIA_URL_PREFIX: &str = "/media/";

/// Payload length floor: guards against accidental matches in ordinary text.
static DATA_URL_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"data:([A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+);base64,([A-Za-z0-9+/=]{128,})").unwrap()
});

/// The only naming scheme upload/migration produce: /media/<uuid>.<ext>.
static MEDIA_REF_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"/media/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[A-Za-z0-9]{1,16})").unwrap()
});

pub fn decode_data_url(data_url: &str) -> Option<(String, Vec<u8>)> {
    let (meta, payload) = data_url.split_once(',')?;
    let mime = meta.strip_prefix("data:")?.strip_suffix(";base64")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(payload).ok()?;
    Some((mime.to_string(), bytes))
}

/// Extension derived from the mime type — new types work without code
/// changes (subtype is sanitized and used as-is); aliases cover the cases
/// where the conventional extension differs from the subtype.
pub fn ext_for_mime(mime: &str) -> String {
    let lower = mime.trim().to_ascii_lowercase();
    match lower.as_str() {
        "image/jpeg" | "image/pjpeg" => return "jpg".into(),
        "image/svg+xml" => return "svg".into(),
        "audio/mpeg" | "audio/mp3" | "audio/x-mpeg" => return "mp3".into(),
        "audio/wav" | "audio/x-wav" | "audio/wave" => return "wav".into(),
        "image/x-icon" | "image/vnd.microsoft.icon" => return "ico".into(),
        _ => {}
    }
    let subtype = lower.rsplit('/').next().unwrap_or_default();
    let cleaned: String = subtype.chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect();
    if cleaned.is_empty() { "bin".into() } else { cleaned }
}

pub fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

/// Replace every embedded data URL with a `/media/<file>` reference, writing
/// the decoded bytes to disk. Idempotent — re-running on transformed text is
/// a no-op.
pub async fn extract_data_urls(media_dir: &Path, text: &str) -> std::io::Result<(String, usize)> {
    let matches: Vec<(usize, usize)> = DATA_URL_RE.find_iter(text).map(|m| (m.start(), m.end())).collect();
    if matches.is_empty() {
        return Ok((text.to_string(), 0));
    }
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let mut written = 0;
    for (start, end) in matches {
        let Some((mime, bytes)) = decode_data_url(&text[start..end]) else { continue };
        let name = format!("{}.{}", uuid::Uuid::new_v4(), ext_for_mime(&mime));
        tokio::fs::write(media_dir.join(&name), &bytes).await?;
        out.push_str(&text[last..start]);
        out.push_str(MEDIA_URL_PREFIX);
        out.push_str(&name);
        last = end;
        written += 1;
    }
    out.push_str(&text[last..]);
    Ok((out, written))
}

/// Reverse of `extract_data_urls`, for backups: re-inline every `/media/`
/// reference as a data URL so the export file is self-contained. References
/// whose file is missing are kept as-is with a warning.
pub async fn embed_media_files(media_dir: &Path, text: &str) -> (String, usize) {
    let matches: Vec<(usize, usize, String)> = MEDIA_REF_RE
        .captures_iter(text)
        .map(|c| {
            let whole = c.get(0).unwrap();
            (whole.start(), whole.end(), c[1].to_string())
        })
        .collect();
    if matches.is_empty() {
        return (text.to_string(), 0);
    }
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let mut embedded = 0;
    for (start, end, name) in matches {
        match tokio::fs::read(media_dir.join(&name)).await {
            Ok(bytes) => {
                let mime = mime_for_ext(name.rsplit('.').next().unwrap_or_default());
                out.push_str(&text[last..start]);
                out.push_str("data:");
                out.push_str(mime);
                out.push_str(";base64,");
                out.push_str(&base64::engine::general_purpose::STANDARD.encode(bytes));
                last = end;
                embedded += 1;
            }
            Err(_) => tracing::warn!(name, "media export: file missing, reference kept"),
        }
    }
    out.push_str(&text[last..]);
    (out, embedded)
}

pub fn collect_media_refs(text: &str, out: &mut HashSet<String>) {
    for c in MEDIA_REF_RE.captures_iter(text) {
        out.insert(c[1].to_string());
    }
}

/// (table, pk, text column) triples holding user JSON that may contain data
/// URLs or /media/ references: every resource table's `data`, plus kv,
/// preset modules and speech-cache metadata.
fn text_columns() -> Vec<(&'static str, &'static str, &'static str)> {
    let mut cols: Vec<_> = crate::resources::import_order()
        .into_iter()
        .map(|(_, res)| (res.table, res.pk, "data"))
        .collect();
    cols.extend([("speech_cache", "message_id", "data"), ("kv", "key", "value"), ("prompt_presets", "name", "modules")]);
    cols
}

/// Startup migration: move any data URLs still stored in the database into
/// media files. Runs on every boot; rows already using /media/ references
/// make it a no-op, and rows that fail are retried next boot.
pub async fn migrate_data_urls_to_files(pool: &SqlitePool, media_dir: &Path) {
    for (table, pk, col) in text_columns() {
        let rows: Vec<(String, Option<String>)> = match sqlx::query_as(&format!("SELECT \"{pk}\", \"{col}\" FROM \"{table}\"")).fetch_all(pool).await {
            Ok(rows) => rows,
            Err(error) => {
                tracing::warn!(?error, table, "media migration: scan failed, table skipped");
                continue;
            }
        };
        let mut migrated = 0usize;
        for (id, text) in rows {
            let Some(text) = text else { continue };
            match extract_data_urls(media_dir, &text).await {
                Ok((_, 0)) => {}
                Ok((new_text, _)) => match sqlx::query(&format!("UPDATE \"{table}\" SET \"{col}\" = ? WHERE \"{pk}\" = ?")).bind(new_text).bind(&id).execute(pool).await {
                    Ok(_) => migrated += 1,
                    Err(error) => tracing::warn!(?error, table, id, "media migration: update failed"),
                },
                Err(error) => tracing::warn!(?error, table, id, "media migration: extraction failed, row skipped"),
            }
        }
        if migrated > 0 {
            tracing::info!(table, migrated, "media migration: data URLs moved to files");
        }
    }
}

/// Delete files under media_dir that no table references anymore. Records
/// are never unlinked eagerly at delete time — a save snapshot may still
/// hold a copy of the reference, so sweeping against a full reference scan
/// is the only safe point.
pub async fn gc_orphan_files(pool: &SqlitePool, media_dir: &Path) -> AppResult<(usize, u64)> {
    let mut refs = HashSet::new();
    for (table, _, col) in text_columns() {
        let rows: Vec<(Option<String>,)> = sqlx::query_as(&format!("SELECT \"{col}\" FROM \"{table}\"")).fetch_all(pool).await?;
        for (text,) in rows {
            let Some(text) = text else { continue };
            collect_media_refs(&text, &mut refs);
        }
    }
    let speech_paths: Vec<(String,)> = sqlx::query_as("SELECT file_path FROM speech_cache").fetch_all(pool).await?;
    for (path,) in speech_paths {
        if let Some(name) = path.strip_prefix(MEDIA_URL_PREFIX) {
            refs.insert(name.to_string());
        }
    }

    let mut removed = 0usize;
    let mut freed = 0u64;
    let mut dir = tokio::fs::read_dir(media_dir).await?;
    while let Some(entry) = dir.next_entry().await? {
        let Ok(name) = entry.file_name().into_string() else { continue };
        if refs.contains(&name) || !is_generated_name(&name) {
            continue;
        }
        let size = entry.metadata().await.map(|m| m.len()).unwrap_or(0);
        match tokio::fs::remove_file(entry.path()).await {
            Ok(()) => {
                removed += 1;
                freed += size;
            }
            Err(error) => tracing::warn!(?error, name, "media gc: remove failed"),
        }
    }
    Ok((removed, freed))
}

/// Only `<uuid>.<ext>` files are sweep candidates — anything else in the
/// directory (user files, future sidecars) is left alone.
fn is_generated_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    !ext.is_empty() && ext.chars().all(|c| c.is_ascii_alphanumeric()) && uuid::Uuid::parse_str(stem).is_ok()
}
