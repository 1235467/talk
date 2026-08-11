//! Atomic finance operations. The web app used Dexie transactions for these;
//! balance read-modify-write must stay in one server transaction, and
//! idempotency keys make client retries safe.

use axum::{extract::State, Json};
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    routes::ok,
    state::AppState,
};

const USER_WALLET_ID: &str = "user";
const AI_TEST_PREFIX: &str = "ai-test-";

type Tx<'a> = sqlx::Transaction<'a, sqlx::Sqlite>;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Build the `data` JSON of a wallet account row.
fn account_data(owner_id: &str, balance: i64, updated_at: i64) -> serde_json::Value {
    serde_json::json!({ "ownerId": owner_id, "balance": balance, "updatedAt": updated_at })
}

async fn read_balance(tx: &mut Tx<'_>, owner_id: &str) -> AppResult<Option<i64>> {
    let row: Option<(i64,)> = sqlx::query_as("SELECT balance FROM wallet_accounts WHERE owner_id = ?")
        .bind(owner_id)
        .fetch_optional(&mut **tx)
        .await?;
    Ok(row.map(|(balance,)| balance))
}

async fn write_balance(tx: &mut Tx<'_>, owner_id: &str, balance: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO wallet_accounts (owner_id, balance, updated_at, data) VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at, data = excluded.data",
    )
    .bind(owner_id)
    .bind(balance)
    .bind(now)
    .bind(serde_json::to_string(&account_data(owner_id, balance, now))?)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferBody {
    from: Option<String>,
    to: Option<String>,
    amount: i64,
    kind: String,
    note: Option<String>,
    idempotency_key: Option<String>,
    status: Option<String>,
}

/// The shared ledger move: idempotency check, balance check, account updates,
/// transaction row insert. Returns the transaction's data JSON.
async fn apply_transfer(tx: &mut Tx<'_>, body: &TransferBody) -> AppResult<serde_json::Value> {
    let amount = body.amount;
    if amount <= 0 {
        return Err(AppError::BadRequest("金额必须是正整数".into()));
    }
    if body.from.is_none() && body.to.is_none() {
        return Err(AppError::BadRequest("资金交易缺少账户".into()));
    }
    let status = body.status.as_deref().unwrap_or("completed");

    if let Some(key) = &body.idempotency_key {
        let existing: Option<(String,)> = sqlx::query_as("SELECT data FROM wallet_transactions WHERE idempotency_key = ?")
            .bind(key)
            .fetch_optional(&mut **tx)
            .await?;
        if let Some((data,)) = existing {
            let row: serde_json::Value = serde_json::from_str(&data)?;
            let same = row.get("fromOwnerId").and_then(|v| v.as_str()) == body.from.as_deref()
                && row.get("toOwnerId").and_then(|v| v.as_str()) == body.to.as_deref()
                && row.get("amount").and_then(|v| v.as_i64()) == Some(amount)
                && row.get("kind").and_then(|v| v.as_str()) == Some(body.kind.as_str())
                && row.get("status").and_then(|v| v.as_str()) == Some(status);
            if !same {
                return Err(AppError::Conflict("幂等键已用于另一笔交易".into()));
            }
            return Ok(row);
        }
    }

    let now = now_ms();
    if let Some(from) = &body.from {
        let balance = read_balance(tx, from).await?;
        let Some(balance) = balance else {
            return Err(AppError::BadRequest("余额不足".into()));
        };
        if balance < amount {
            return Err(AppError::BadRequest("余额不足".into()));
        }
        write_balance(tx, from, balance - amount, now).await?;
    }
    if let Some(to) = &body.to {
        let balance = read_balance(tx, to).await?.unwrap_or(0);
        write_balance(tx, to, balance + amount, now).await?;
    }

    let mut data = serde_json::Map::new();
    let id = uuid::Uuid::new_v4().to_string();
    data.insert("id".into(), serde_json::Value::from(id.clone()));
    if let Some(key) = &body.idempotency_key {
        data.insert("idempotencyKey".into(), serde_json::Value::from(key.clone()));
    }
    data.insert("kind".into(), serde_json::Value::from(body.kind.clone()));
    if let Some(from) = &body.from {
        data.insert("fromOwnerId".into(), serde_json::Value::from(from.clone()));
    }
    if let Some(to) = &body.to {
        data.insert("toOwnerId".into(), serde_json::Value::from(to.clone()));
    }
    data.insert("amount".into(), serde_json::Value::from(amount));
    if let Some(note) = &body.note {
        data.insert("note".into(), serde_json::Value::from(note.clone()));
    }
    data.insert("status".into(), serde_json::Value::from(status));
    data.insert("createdAt".into(), serde_json::Value::from(now));
    if status == "completed" {
        data.insert("completedAt".into(), serde_json::Value::from(now));
    }
    let data = serde_json::Value::Object(data);

    sqlx::query(
        "INSERT INTO wallet_transactions (id, idempotency_key, kind, from_owner_id, to_owner_id, amount, status, created_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&body.idempotency_key)
    .bind(&body.kind)
    .bind(&body.from)
    .bind(&body.to)
    .bind(amount)
    .bind(status)
    .bind(now)
    .bind(serde_json::to_string(&data)?)
    .execute(&mut **tx)
    .await?;
    Ok(data)
}

pub async fn transfer(State(state): State<AppState>, Json(body): Json<TransferBody>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.db.begin().await?;
    let row = apply_transfer(&mut tx, &body).await?;
    tx.commit().await?;
    Ok(ok(row))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRedPacketBody {
    transaction_id: String,
    to: String,
}

pub async fn claim_red_packet(State(state): State<AppState>, Json(body): Json<ClaimRedPacketBody>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.db.begin().await?;
    let row: Option<(String, i64, String, String)> = sqlx::query_as("SELECT data, amount, kind, status FROM wallet_transactions WHERE id = ?")
        .bind(&body.transaction_id)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((data, amount, kind, status)) = row else {
        return Err(AppError::BadRequest("红包已领取或不存在".into()));
    };
    if kind != "red_packet" || status != "reserved" {
        return Err(AppError::BadRequest("红包已领取或不存在".into()));
    }

    let now = now_ms();
    let balance = read_balance(&mut tx, &body.to).await?.unwrap_or(0);
    write_balance(&mut tx, &body.to, balance + amount, now).await?;

    let mut value: serde_json::Value = serde_json::from_str(&data)?;
    value["toOwnerId"] = serde_json::Value::from(body.to.clone());
    value["status"] = serde_json::Value::from("completed");
    value["completedAt"] = serde_json::Value::from(now);
    sqlx::query("UPDATE wallet_transactions SET to_owner_id = ?, status = 'completed', data = ? WHERE id = ?")
        .bind(&body.to)
        .bind(serde_json::to_string(&value)?)
        .bind(&body.transaction_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(ok(value))
}

/// Ensure wallet rows exist for the user and every contact; migrate the
/// legacy settings.balance into the user wallet exactly once.
pub async fn ensure(State(state): State<AppState>) -> AppResult<Json<serde_json::Value>> {
    let mut tx = state.db.begin().await?;
    let now = now_ms();

    let kv_get = |key: &str| {
        let db = state.db.clone();
        let key = key.to_string();
        async move {
            let row: Option<(String,)> = sqlx::query_as("SELECT value FROM kv WHERE key = ?")
                .bind(&key)
                .fetch_optional(&db)
                .await?;
            Ok::<_, sqlx::Error>(row.and_then(|(v,)| serde_json::from_str::<serde_json::Value>(&v).ok()))
        }
    };
    let migrated = kv_get("walletMigrated").await?.and_then(|v| v.as_bool()).unwrap_or(false);
    let legacy = if migrated {
        0
    } else {
        kv_get("walletBalance").await?.and_then(|v| v.as_i64()).filter(|v| *v > 0).unwrap_or(0)
    };

    if read_balance(&mut tx, USER_WALLET_ID).await?.is_none() {
        if legacy > 0 {
            // The transfer itself creates the account and records the migration row.
            apply_transfer(
                &mut tx,
                &TransferBody {
                    from: None,
                    to: Some(USER_WALLET_ID.to_string()),
                    amount: legacy,
                    kind: "migration".into(),
                    note: None,
                    idempotency_key: Some("legacy-wallet-migration".into()),
                    status: None,
                },
            )
            .await?;
        } else {
            write_balance(&mut tx, USER_WALLET_ID, 0, now).await?;
        }
    }
    let contacts: Vec<(String,)> = sqlx::query_as("SELECT id FROM contacts").fetch_all(&mut *tx).await?;
    for (contact_id,) in contacts {
        if contact_id.starts_with(AI_TEST_PREFIX) {
            continue;
        }
        if read_balance(&mut tx, &contact_id).await?.is_none() {
            write_balance(&mut tx, &contact_id, 0, now).await?;
        }
    }
    sqlx::query("INSERT INTO kv (key, value, updated_at) VALUES ('walletMigrated', 'true', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(ok(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurchaseBody {
    name: String,
    description: String,
    icon: String,
    price: i64,
    product_key: String,
    note: Option<String>,
}

/// Buying a shop product charges the user wallet and adds the inventory card
/// plus the repurchase-history row — all in one transaction.
pub async fn purchase(State(state): State<AppState>, Json(body): Json<PurchaseBody>) -> AppResult<Json<serde_json::Value>> {
    if body.price <= 0 {
        return Err(AppError::BadRequest("金额必须是正整数".into()));
    }
    let mut tx = state.db.begin().await?;
    let now = now_ms();
    apply_transfer(
        &mut tx,
        &TransferBody {
            from: Some(USER_WALLET_ID.to_string()),
            to: None,
            amount: body.price,
            kind: "purchase".into(),
            note: body.note.clone().or(Some(body.name.clone())),
            idempotency_key: None,
            status: None,
        },
    )
    .await?;

    let item = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "productKey": body.product_key,
        "name": body.name,
        "description": body.description,
        "icon": body.icon,
        "price": body.price,
        "acquiredAt": now,
    });
    sqlx::query("INSERT INTO inventory (id, product_key, name, acquired_at, data) VALUES (?, ?, ?, ?, ?)")
        .bind(item["id"].as_str().unwrap())
        .bind(&body.product_key)
        .bind(&body.name)
        .bind(now)
        .bind(serde_json::to_string(&item)?)
        .execute(&mut *tx)
        .await?;

    let history: Option<(String,)> = sqlx::query_as("SELECT data FROM shop_purchase_history WHERE product_key = ?")
        .bind(&body.product_key)
        .fetch_optional(&mut *tx)
        .await?;
    let mut entry = match history {
        Some((data,)) => serde_json::from_str::<serde_json::Value>(&data)?,
        None => serde_json::json!({
            "productKey": body.product_key,
            "name": body.name,
            "description": body.description,
            "icon": body.icon,
            "price": body.price,
            "purchaseCount": 0,
            "firstPurchasedAt": now,
        }),
    };
    entry["purchaseCount"] = serde_json::Value::from(entry["purchaseCount"].as_i64().unwrap_or(0) + 1);
    entry["lastPurchasedAt"] = serde_json::Value::from(now);
    sqlx::query(
        "INSERT INTO shop_purchase_history (product_key, last_purchased_at, data) VALUES (?, ?, ?)
         ON CONFLICT(product_key) DO UPDATE SET last_purchased_at = excluded.last_purchased_at, data = excluded.data",
    )
    .bind(&body.product_key)
    .bind(now)
    .bind(serde_json::to_string(&entry)?)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(ok(item))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimSalariesBody {
    date: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimSalariesResult {
    user_amount: i64,
    contact_amount: i64,
    contact_count: usize,
    date: String,
}

/// Daily payroll, user-triggered. Every transfer carries an idempotency key,
/// so a retry after a partial run repairs the payroll instead of double-paying.
pub async fn claim_daily_salaries(State(state): State<AppState>, Json(body): Json<ClaimSalariesBody>) -> AppResult<Json<serde_json::Value>> {
    let date = body.date;
    let mut tx = state.db.begin().await?;

    let kv_get = |key: &str| {
        let db = state.db.clone();
        let key = key.to_string();
        async move {
            let row: Option<(String,)> = sqlx::query_as("SELECT value FROM kv WHERE key = ?")
                .bind(&key)
                .fetch_optional(&db)
                .await?;
            Ok::<_, sqlx::Error>(row.and_then(|(v,)| serde_json::from_str::<serde_json::Value>(&v).ok()))
        }
    };
    let occupation = kv_get("userOccupation").await?.and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
    let monthly = kv_get("userMonthlySalary").await?.and_then(|v| v.as_i64()).unwrap_or(0);
    if occupation.is_empty() || monthly <= 0 {
        return Err(AppError::BadRequest("需要先入职才能领取工资".into()));
    }

    let user_amount = (monthly / 30).max(1);
    let user_key = format!("salary:{USER_WALLET_ID}:{date}");
    let already: Option<(String,)> = sqlx::query_as("SELECT id FROM wallet_transactions WHERE idempotency_key = ?")
        .bind(&user_key)
        .fetch_optional(&mut *tx)
        .await?;
    let already_claimed = already.is_some();
    if !already_claimed {
        apply_transfer(
            &mut tx,
            &TransferBody {
                from: None,
                to: Some(USER_WALLET_ID.to_string()),
                amount: user_amount,
                kind: "salary".into(),
                note: Some(format!("{occupation}工资")),
                idempotency_key: Some(user_key),
                status: None,
            },
        )
        .await?;
    }

    let mut contact_amount = 0i64;
    let mut contact_count = 0usize;
    let contacts: Vec<(String, String)> = sqlx::query_as("SELECT id, data FROM contacts").fetch_all(&mut *tx).await?;
    for (contact_id, data) in contacts {
        if contact_id.starts_with(AI_TEST_PREFIX) {
            continue;
        }
        let contact: serde_json::Value = serde_json::from_str(&data)?;
        let contact_occupation = contact.get("occupation").and_then(|v| v.as_str()).unwrap_or("");
        let contact_monthly = contact.get("monthlySalary").and_then(|v| v.as_i64()).unwrap_or(0);
        if contact_occupation.is_empty() || contact_monthly <= 0 {
            continue;
        }
        let amount = (contact_monthly / 30).max(1);
        apply_transfer(
            &mut tx,
            &TransferBody {
                from: None,
                to: Some(contact_id.clone()),
                amount,
                kind: "salary".into(),
                note: Some(format!("{contact_occupation}工资")),
                idempotency_key: Some(format!("salary:{contact_id}:{date}")),
                status: None,
            },
        )
        .await?;
        sqlx::query("UPDATE contacts SET data = json_set(data, '$.lastSalaryDate', ?) WHERE id = ?")
            .bind(&date)
            .bind(&contact_id)
            .execute(&mut *tx)
            .await?;
        contact_amount += amount;
        contact_count += 1;
    }

    // Report a duplicate user claim only after repairing contact payments.
    if already_claimed {
        return Err(AppError::BadRequest("今天已经领取过工资了".into()));
    }
    tx.commit().await?;
    Ok(ok(serde_json::json!(ClaimSalariesResult {
        user_amount,
        contact_amount,
        contact_count,
        date,
    })))
}
