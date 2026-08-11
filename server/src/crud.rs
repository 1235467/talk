//! Generic REST CRUD over the domain tables.
//!
//! Every row keeps its complete object in a `data` JSON column; the few real
//! columns exist only for filtering/ordering. Writes extract indexed fields
//! from the JSON body, mirror id-array fields into join tables, all inside
//! one transaction. Responses are the `data` blobs re-serialized, so the
//! frontend's TypeScript types pass through untouched.

use serde::Deserialize;
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy)]
pub enum ColType {
    Text,
    Int,
    Real,
}

/// An indexed column mirrored out of the JSON payload.
#[derive(Debug, Clone, Copy)]
pub struct Col {
    pub name: &'static str,
    pub json: &'static str,
    pub ty: ColType,
}

/// A join table mirroring an id-array field of the payload.
#[derive(Debug, Clone, Copy)]
pub struct Join {
    pub table: &'static str,
    pub fk: &'static str,
    pub json: &'static str,
}

pub struct Resource {
    pub table: &'static str,
    pub pk: &'static str,
    pub pk_json: &'static str,
    pub cols: &'static [Col],
    pub join: Option<Join>,
    pub default_order: &'static str,
}

#[derive(Debug, Deserialize)]
pub struct ListParams {
    #[serde(flatten)]
    pub filters: std::collections::HashMap<String, String>,
}

fn json_value_to_sql(value: &serde_json::Value, ty: ColType) -> Option<serde_json::Value> {
    match (ty, value) {
        (_, serde_json::Value::Null) => None,
        (ColType::Text, v @ serde_json::Value::String(_)) => Some(v.clone()),
        (ColType::Int, v @ serde_json::Value::Number(_)) => Some(v.clone()),
        (ColType::Real, v @ serde_json::Value::Number(_)) => Some(v.clone()),
        (ColType::Text, v @ serde_json::Value::Number(_)) => Some(serde_json::Value::String(v.to_string())),
        (ColType::Int, serde_json::Value::String(s)) => s.parse::<i64>().ok().map(serde_json::Value::from),
        _ => Some(value.clone()),
    }
}

pub async fn list(pool: &SqlitePool, res: &Resource, params: &ListParams, limit: Option<i64>, before: Option<(i64, String)>) -> AppResult<Vec<serde_json::Value>> {
    let mut sql = format!("SELECT data FROM \"{}\"", res.table);
    let mut binds: Vec<serde_json::Value> = Vec::new();
    let mut clauses: Vec<String> = Vec::new();
    for (key, value) in &params.filters {
        if key == "limit" || key == "before" || key == "order" {
            continue;
        }
        let Some(col) = res.cols.iter().find(|c| c.name == key || c.json == key) else {
            return Err(AppError::BadRequest(format!("cannot filter {key} on {}", res.table)));
        };
        clauses.push(format!("\"{}\" = ?", col.name));
        binds.push(serde_json::Value::String(value.clone()));
    }
    if let Some((ts, id)) = &before {
        clauses.push(format!("(created_at < ? OR (created_at = ? AND \"{}\" < ?))", res.pk));
        binds.push(serde_json::Value::from(*ts));
        binds.push(serde_json::Value::from(*ts));
        binds.push(serde_json::Value::String(id.clone()));
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(&format!(" ORDER BY {}", res.default_order));
    if let Some(limit) = limit {
        sql.push_str(&format!(" LIMIT {}", limit.max(1).min(500)));
    }
    let mut query = sqlx::query_as::<_, (String,)>(&sql);
    for bind in binds {
        let text = match bind {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        };
        query = query.bind(text);
    }
    let rows = query.fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .filter_map(|(data,)| serde_json::from_str(&data).ok())
        .collect())
}

pub async fn get(pool: &SqlitePool, res: &Resource, id: &str) -> AppResult<serde_json::Value> {
    let row: Option<(String,)> = sqlx::query_as(&format!("SELECT data FROM \"{}\" WHERE \"{}\" = ?", res.table, res.pk))
        .bind(id)
        .fetch_optional(pool)
        .await?;
    let (data,) = row.ok_or(AppError::NotFound)?;
    Ok(serde_json::from_str(&data)?)
}

pub async fn upsert(pool: &SqlitePool, res: &Resource, body: serde_json::Value) -> AppResult<serde_json::Value> {
    let pk = body
        .get(res.pk_json)
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest(format!("{} is required", res.pk_json)))?
        .to_string();
    let data = serde_json::to_string(&body)?;

    let mut names = vec![format!("\"{}\"", res.pk), "data".to_string()];
    let mut values: Vec<Option<String>> = vec![Some(pk.clone()), Some(data)];
    for col in res.cols {
        names.push(format!("\"{}\"", col.name));
        let raw = body.get(col.json).cloned().unwrap_or(serde_json::Value::Null);
        values.push(json_value_to_sql(&raw, col.ty).map(|v| match v {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        }));
    }

    let placeholders: Vec<String> = (0..names.len()).map(|_| "?".into()).collect();
    let updates: Vec<String> = names
        .iter()
        .filter(|n| *n != &format!("\"{}\"", res.pk))
        .map(|n| format!("{n} = excluded.{n}"))
        .collect();
    let sql = format!(
        "INSERT INTO \"{}\" ({}) VALUES ({}) ON CONFLICT(\"{}\") DO UPDATE SET {}",
        res.table,
        names.join(", "),
        placeholders.join(", "),
        res.pk,
        updates.join(", ")
    );

    let mut tx = pool.begin().await?;
    let mut query = sqlx::query(&sql);
    for value in &values {
        query = query.bind(value);
    }
    query.execute(&mut *tx).await?;

    if let Some(join) = res.join {
        sqlx::query(&format!("DELETE FROM \"{}\" WHERE \"{}\" = ?", join.table, join.fk))
            .bind(&pk)
            .execute(&mut *tx)
            .await?;
        if let Some(ids) = body.get(join.json).and_then(|v| v.as_array()) {
            for id in ids.iter().filter_map(|v| v.as_str()) {
                sqlx::query(&format!("INSERT OR IGNORE INTO \"{}\" (\"{}\", \"{}\") VALUES (?, ?)", join.table, join.fk, id_col(join.table)))
                    .bind(&pk)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
    }
    tx.commit().await?;
    Ok(body)
}

/// The non-fk column of a join table (everything except <table>.fk which points back).
fn id_col(table: &str) -> &'static str {
    match table {
        "group_members" => "contact_id",
        "worldbook_entry_keywords" => "keyword",
        "library_item_keywords" => "keyword",
        "life_event_participants" => "contact_id",
        "contact_experience_contacts" => "contact_id",
        "social_event_contacts" => "contact_id",
        "contact_memory_contacts" => "contact_id",
        "media_asset_owners" => "contact_id",
        _ => "contact_id",
    }
}

pub async fn remove(pool: &SqlitePool, res: &Resource, id: &str) -> AppResult<()> {
    let result = sqlx::query(&format!("DELETE FROM \"{}\" WHERE \"{}\" = ?", res.table, res.pk))
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Query param parsing shared by all list endpoints: `?limit=` & `?before=ts,id`
/// plus equality filters on the resource's indexed columns.
pub fn parse_page(params: &ListParams) -> (Option<i64>, Option<(i64, String)>) {
    let limit = params.filters.get("limit").and_then(|v| v.parse::<i64>().ok());
    let before = params.filters.get("before").and_then(|v| {
        let (ts, id) = v.split_once(',')?;
        Some((ts.parse::<i64>().ok()?, id.to_string()))
    });
    (limit, before)
}

macro_rules! crud_routes {
    ($mod_name:ident, $path:literal, $res:expr) => {
        pub mod $mod_name {
            use axum::{extract::{Path, Query, State}, Json};
            use crate::crud::{parse_page, ListParams, Resource};
            #[allow(unused_imports)]
            use crate::crud::Join;
            use crate::error::AppResult;
            use crate::state::AppState;
            #[allow(unused_imports)]
            use crate::resources::{int, real, text};
            pub const RES: Resource = $res;

            pub async fn list(State(state): State<AppState>, Query(params): Query<ListParams>) -> AppResult<Json<serde_json::Value>> {
                let (limit, before) = parse_page(&params);
                Ok(Json(serde_json::json!(crate::crud::list(&state.db, &RES, &params, limit, before).await?)))
            }
            pub async fn get(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
                Ok(Json(crate::crud::get(&state.db, &RES, &id).await?))
            }
            pub async fn upsert(State(state): State<AppState>, Json(body): Json<serde_json::Value>) -> AppResult<Json<serde_json::Value>> {
                Ok(Json(crate::crud::upsert(&state.db, &RES, body).await?))
            }
            pub async fn bulk_upsert(State(state): State<AppState>, Json(body): Json<Vec<serde_json::Value>>) -> AppResult<Json<serde_json::Value>> {
                for item in body {
                    crate::crud::upsert(&state.db, &RES, item).await?;
                }
                Ok(Json(serde_json::json!({ "ok": true })))
            }
            pub async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> AppResult<Json<serde_json::Value>> {
                crate::crud::remove(&state.db, &RES, &id).await?;
                Ok(Json(serde_json::json!({ "ok": true })))
            }
        }
    };
}

pub(crate) use crud_routes;
