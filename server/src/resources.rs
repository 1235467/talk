//! Resource declarations for every domain table and the route wiring.

use axum::{routing::get, Router};

use crate::crud::{crud_routes, Col, ColType::*, Resource};

const fn text(name: &'static str, json: &'static str) -> Col {
    Col { name, json, ty: Text }
}
const fn int(name: &'static str, json: &'static str) -> Col {
    Col { name, json, ty: Int }
}
const fn real(name: &'static str, json: &'static str) -> Col {
    Col { name, json, ty: Real }
}

crud_routes!(contacts, "/contacts", Resource {
    table: "contacts",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("worldview_id", "worldviewId"),
        text("name", "name"),
        text("preset_name", "presetName"),
        int("warmth", "warmth"),
        int("last_moment_at", "lastMomentAt"),
        int("created_at", "createdAt"),
    ],
    join: None,
    default_order: "created_at",
});

crud_routes!(conversations, "/conversations", Resource {
    table: "conversations",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("contact_id", "contactId"),
        text("group_id", "groupId"),
        int("updated_at", "updatedAt"),
        int("created_at", "createdAt"),
    ],
    join: None,
    default_order: "updated_at DESC",
});

crud_routes!(messages, "/messages", Resource {
    table: "messages",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("conversation_id", "conversationId"),
        text("role", "role"),
        text("type", "type"),
        text("speaker_contact_id", "speakerContactId"),
        int("created_at", "createdAt"),
    ],
    join: None,
    default_order: "created_at, id",
});

crud_routes!(groups, "/groups", Resource {
    table: "groups",
    pk: "id",
    pk_json: "id",
    cols: &[text("name", "name"), int("created_at", "createdAt")],
    join: Some(Join { table: "group_members", fk: "group_id", json: "memberContactIds" }),
    default_order: "created_at",
});

crud_routes!(stickers, "/stickers", Resource {
    table: "stickers",
    pk: "id",
    pk_json: "id",
    cols: &[text("name", "name"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at",
});

crud_routes!(contact_relations, "/contact-relations", Resource {
    table: "contact_relations",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("from_contact_id", "fromContactId"),
        text("to_contact_id", "toContactId"),
        text("pair_id", "pairId"),
        text("label", "label"),
        int("created_at", "createdAt"),
    ],
    join: None,
    default_order: "created_at",
});

crud_routes!(moments, "/moments", Resource {
    table: "moments",
    pk: "id",
    pk_json: "id",
    cols: &[text("contact_id", "contactId"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(moment_comments, "/moment-comments", Resource {
    table: "moment_comments",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("moment_id", "momentId"),
        text("author_contact_id", "authorContactId"),
        text("reply_to_comment_id", "replyToCommentId"),
        int("created_at", "createdAt"),
    ],
    join: None,
    default_order: "created_at, id",
});

crud_routes!(moment_likes, "/moment-likes", Resource {
    table: "moment_likes",
    pk: "id",
    pk_json: "id",
    cols: &[text("moment_id", "momentId"), text("liker_id", "likerId"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at",
});

crud_routes!(worldbook_collections, "/worldbook-collections", Resource {
    table: "worldbook_collections",
    pk: "id",
    pk_json: "id",
    cols: &[text("name", "name"), int("enabled", "enabled"), int("updated_at", "updatedAt"), int("created_at", "createdAt")],
    join: None,
    default_order: "updated_at DESC",
});

crud_routes!(worldbook_entries, "/worldbook-entries", Resource {
    table: "worldbook_entries",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("collection_id", "collectionId"),
        int("source_order", "sourceOrder"),
        int("priority", "priority"),
        int("enabled", "enabled"),
        int("created_at", "createdAt"),
        int("updated_at", "updatedAt"),
    ],
    join: Some(Join { table: "worldbook_entry_keywords", fk: "entry_id", json: "keywords" }),
    default_order: "collection_id, source_order",
});

crud_routes!(library_items, "/library-items", Resource {
    table: "library_items",
    pk: "id",
    pk_json: "id",
    cols: &[text("source_type", "sourceType"), text("title", "title"), int("created_at", "createdAt"), int("updated_at", "updatedAt")],
    join: Some(Join { table: "library_item_keywords", fk: "item_id", json: "keywords" }),
    default_order: "updated_at DESC",
});

crud_routes!(saved_worldviews, "/saved-worldviews", Resource {
    table: "saved_worldviews",
    pk: "id",
    pk_json: "id",
    cols: &[text("name", "name"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(simulation_state, "/simulation-state", Resource {
    table: "simulation_state",
    pk: "id",
    pk_json: "id",
    cols: &[],
    join: None,
    default_order: "id",
});

crud_routes!(contact_life_states, "/contact-life-states", Resource {
    table: "contact_life_states",
    pk: "contact_id",
    pk_json: "contactId",
    cols: &[int("updated_at", "updatedAt")],
    join: None,
    default_order: "contact_id",
});

crud_routes!(life_events, "/life-events", Resource {
    table: "life_events",
    pk: "id",
    pk_json: "id",
    cols: &[text("contact_id", "contactId"), text("type", "type"), int("occurred_at", "occurredAt")],
    join: Some(Join { table: "life_event_participants", fk: "event_id", json: "participantContactIds" }),
    default_order: "occurred_at DESC",
});

crud_routes!(contact_experiences, "/contact-experiences", Resource {
    table: "contact_experiences",
    pk: "id",
    pk_json: "id",
    cols: &[text("kind", "kind"), text("memory_tier", "memoryTier"), int("start_at", "startedAt"), int("created_at", "createdAt")],
    join: Some(Join { table: "contact_experience_contacts", fk: "experience_id", json: "contactIds" }),
    default_order: "created_at DESC",
});

crud_routes!(social_events, "/social-events", Resource {
    table: "social_events",
    pk: "id",
    pk_json: "id",
    cols: &[text("actor_id", "actorId"), text("target_id", "targetId"), int("created_at", "createdAt")],
    join: Some(Join { table: "social_event_contacts", fk: "event_id", json: "relatedContactIds" }),
    default_order: "created_at DESC",
});

crud_routes!(contact_memories, "/contact-memories", Resource {
    table: "contact_memories",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("contact_id", "contactId"),
        text("scope", "scope"),
        text("category", "category"),
        real("importance", "importance"),
        int("created_at", "createdAt"),
        int("updated_at", "updatedAt"),
    ],
    join: Some(Join { table: "contact_memory_contacts", fk: "memory_id", json: "relatedContactIds" }),
    default_order: "created_at DESC",
});

crud_routes!(group_plans, "/group-plans", Resource {
    table: "group_plans",
    pk: "id",
    pk_json: "id",
    cols: &[text("group_id", "groupId"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(internal_tasks, "/internal-tasks", Resource {
    table: "internal_tasks",
    pk: "id",
    pk_json: "id",
    cols: &[text("contact_id", "contactId"), text("conversation_id", "conversationId"), text("kind", "kind"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(saved_personas, "/saved-personas", Resource {
    table: "saved_personas",
    pk: "id",
    pk_json: "id",
    cols: &[text("name", "name"), int("updated_at", "updatedAt"), int("created_at", "createdAt")],
    join: None,
    default_order: "updated_at DESC",
});

crud_routes!(persona_creation_records, "/persona-creation-records", Resource {
    table: "persona_creation_records",
    pk: "id",
    pk_json: "id",
    cols: &[text("source_contact_id", "sourceContactId"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(contact_generation_tasks, "/contact-generation-tasks", Resource {
    table: "contact_generation_tasks",
    pk: "id",
    pk_json: "id",
    cols: &[text("status", "status"), int("created_at", "createdAt"), int("updated_at", "updatedAt")],
    join: None,
    default_order: "created_at",
});

crud_routes!(locations, "/locations", Resource {
    table: "locations",
    pk: "id",
    pk_json: "id",
    cols: &[text("parent_id", "parentId"), text("name", "name"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at",
});

crud_routes!(world_maps, "/world-maps", Resource {
    table: "world_maps",
    pk: "id",
    pk_json: "id",
    cols: &[],
    join: None,
    default_order: "id",
});

crud_routes!(location_module_state, "/location-module-state", Resource {
    table: "location_module_state",
    pk: "id",
    pk_json: "id",
    cols: &[],
    join: None,
    default_order: "id",
});

crud_routes!(acoustic_edges, "/acoustic-edges", Resource {
    table: "acoustic_edges",
    pk: "id",
    pk_json: "id",
    cols: &[text("from_location_id", "fromLocationId"), text("to_location_id", "toLocationId")],
    join: None,
    default_order: "id",
});

crud_routes!(media_assets, "/media-assets", Resource {
    table: "media_assets",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("origin", "origin"),
        text("origin_id", "originId"),
        text("conversation_id", "conversationId"),
        text("status", "status"),
        int("created_at", "createdAt"),
        int("updated_at", "updatedAt"),
    ],
    join: Some(Join { table: "media_asset_owners", fk: "asset_id", json: "ownerContactIds" }),
    default_order: "created_at DESC",
});

crud_routes!(ai_turns, "/ai-turns", Resource {
    table: "ai_turns",
    pk: "id",
    pk_json: "id",
    cols: &[text("conversation_id", "conversationId"), text("contact_id", "contactId"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(ai_usage_records, "/ai-usage-records", Resource {
    table: "ai_usage_records",
    pk: "id",
    pk_json: "id",
    cols: &[text("purpose", "purpose"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(wallet_accounts, "/wallet-accounts", Resource {
    table: "wallet_accounts",
    pk: "owner_id",
    pk_json: "ownerId",
    cols: &[int("balance", "balance"), int("updated_at", "updatedAt")],
    join: None,
    default_order: "owner_id",
});

crud_routes!(wallet_transactions, "/wallet-transactions", Resource {
    table: "wallet_transactions",
    pk: "id",
    pk_json: "id",
    cols: &[
        text("idempotency_key", "idempotencyKey"),
        text("kind", "kind"),
        text("from_owner_id", "fromOwnerId"),
        text("to_owner_id", "toOwnerId"),
        int("amount", "amount"),
        text("status", "status"),
        int("created_at", "createdAt"),
    ],
    join: None,
    default_order: "created_at, id",
});

crud_routes!(loans, "/loans", Resource {
    table: "loans",
    pk: "id",
    pk_json: "id",
    cols: &[text("lender_id", "lenderId"), text("borrower_id", "borrowerId"), text("status", "status"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(inventory, "/inventory", Resource {
    table: "inventory",
    pk: "id",
    pk_json: "id",
    cols: &[text("product_key", "productKey"), text("name", "name"), int("acquired_at", "acquiredAt")],
    join: None,
    default_order: "acquired_at DESC",
});

crud_routes!(shop_purchase_history, "/shop-purchase-history", Resource {
    table: "shop_purchase_history",
    pk: "product_key",
    pk_json: "productKey",
    cols: &[int("last_purchased_at", "lastPurchasedAt")],
    join: None,
    default_order: "last_purchased_at DESC",
});

crud_routes!(job_listings, "/job-listings", Resource {
    table: "job_listings",
    pk: "id",
    pk_json: "id",
    cols: &[text("status", "status"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(interviews, "/interviews", Resource {
    table: "interviews",
    pk: "id",
    pk_json: "id",
    cols: &[text("job_id", "jobId"), text("status", "status"), int("updated_at", "updatedAt"), int("created_at", "createdAt")],
    join: None,
    default_order: "updated_at DESC",
});

crud_routes!(contact_storylines, "/contact-storylines", Resource {
    table: "contact_storylines",
    pk: "id",
    pk_json: "id",
    cols: &[text("contact_id", "contactId"), int("active", "active"), int("updated_at", "updatedAt"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(contact_save_snapshots, "/contact-save-snapshots", Resource {
    table: "contact_save_snapshots",
    pk: "id",
    pk_json: "id",
    cols: &[text("contact_id", "contactId"), text("storyline_id", "storylineId"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(global_save_snapshots, "/global-save-snapshots", Resource {
    table: "global_save_snapshots",
    pk: "id",
    pk_json: "id",
    cols: &[text("resource_type", "resourceType"), text("resource_id", "resourceId"), int("created_at", "createdAt")],
    join: None,
    default_order: "created_at DESC",
});

crud_routes!(speech_cache, "/speech-cache", Resource {
    table: "speech_cache",
    pk: "message_id",
    pk_json: "messageId",
    cols: &[
        text("mime_type", "mimeType"),
        text("file_path", "filePath"),
        text("signature", "signature"),
        text("provider", "provider"),
        int("size", "size"),
        int("duration_ms", "durationMs"),
        int("last_accessed_at", "lastAccessedAt"),
        int("created_at", "createdAt"),
    ],
    join: None,
    default_order: "last_accessed_at",
});

macro_rules! mount {
    ($router:expr, $path:literal, $mod:ident) => {
        $router.route(
            $path,
            get($mod::list).post($mod::upsert),
        )
        .route(concat!($path, "/bulk"), axum::routing::post($mod::bulk_upsert))
        .route(concat!($path, "/bulk-delete"), axum::routing::post($mod::bulk_remove))
        .route(
            concat!($path, "/{id}"),
            get($mod::get).put($mod::upsert).patch($mod::patch).delete($mod::remove),
        )
    };
}

/// Backup-table-name → resource, in FK-safe import order (parents first).
/// Used by `talk-server import` and `POST /api/import`.
pub fn import_order() -> Vec<(&'static str, &'static Resource)> {
    vec![
        ("contacts", &contacts::RES),
        ("walletAccounts", &wallet_accounts::RES),
        ("walletTransactions", &wallet_transactions::RES),
        ("loans", &loans::RES),
        ("inventory", &inventory::RES),
        ("shopPurchaseHistory", &shop_purchase_history::RES),
        ("jobListings", &job_listings::RES),
        ("interviews", &interviews::RES),
        ("contactStorylines", &contact_storylines::RES),
        ("contactSaveSnapshots", &contact_save_snapshots::RES),
        ("globalSaveSnapshots", &global_save_snapshots::RES),
        ("conversations", &conversations::RES),
        ("groups", &groups::RES),
        ("messages", &messages::RES),
        ("stickers", &stickers::RES),
        ("contactRelations", &contact_relations::RES),
        ("moments", &moments::RES),
        ("momentComments", &moment_comments::RES),
        ("momentLikes", &moment_likes::RES),
        ("worldbookCollections", &worldbook_collections::RES),
        ("worldbookEntries", &worldbook_entries::RES),
        ("libraryItems", &library_items::RES),
        ("savedWorldviews", &saved_worldviews::RES),
        ("simulationState", &simulation_state::RES),
        ("contactLifeStates", &contact_life_states::RES),
        ("lifeEvents", &life_events::RES),
        ("contactExperiences", &contact_experiences::RES),
        ("socialEvents", &social_events::RES),
        ("contactMemories", &contact_memories::RES),
        ("groupPlans", &group_plans::RES),
        ("internalTasks", &internal_tasks::RES),
        ("savedPersonas", &saved_personas::RES),
        ("personaCreationRecords", &persona_creation_records::RES),
        ("contactGenerationTasks", &contact_generation_tasks::RES),
        ("locations", &locations::RES),
        ("worldMaps", &world_maps::RES),
        ("locationModuleState", &location_module_state::RES),
        ("acousticEdges", &acoustic_edges::RES),
        ("mediaAssets", &media_assets::RES),
        ("aiTurns", &ai_turns::RES),
        ("aiUsageRecords", &ai_usage_records::RES),
    ]
}

pub fn router() -> Router<crate::state::AppState> {
    let r = Router::new();
    let r = mount!(r, "/contacts", contacts);
    let r = mount!(r, "/conversations", conversations);
    let r = mount!(r, "/messages", messages);
    let r = mount!(r, "/groups", groups);
    let r = mount!(r, "/stickers", stickers);
    let r = mount!(r, "/contact-relations", contact_relations);
    let r = mount!(r, "/moments", moments);
    let r = mount!(r, "/moment-comments", moment_comments);
    let r = mount!(r, "/moment-likes", moment_likes);
    let r = mount!(r, "/worldbook-collections", worldbook_collections);
    let r = mount!(r, "/worldbook-entries", worldbook_entries);
    let r = mount!(r, "/library-items", library_items);
    let r = mount!(r, "/saved-worldviews", saved_worldviews);
    let r = mount!(r, "/simulation-state", simulation_state);
    let r = mount!(r, "/contact-life-states", contact_life_states);
    let r = mount!(r, "/life-events", life_events);
    let r = mount!(r, "/contact-experiences", contact_experiences);
    let r = mount!(r, "/social-events", social_events);
    let r = mount!(r, "/contact-memories", contact_memories);
    let r = mount!(r, "/group-plans", group_plans);
    let r = mount!(r, "/internal-tasks", internal_tasks);
    let r = mount!(r, "/saved-personas", saved_personas);
    let r = mount!(r, "/persona-creation-records", persona_creation_records);
    let r = mount!(r, "/contact-generation-tasks", contact_generation_tasks);
    let r = mount!(r, "/locations", locations);
    let r = mount!(r, "/world-maps", world_maps);
    let r = mount!(r, "/location-module-state", location_module_state);
    let r = mount!(r, "/acoustic-edges", acoustic_edges);
    let r = mount!(r, "/media-assets", media_assets);
    let r = mount!(r, "/ai-turns", ai_turns);
    let r = mount!(r, "/ai-usage-records", ai_usage_records);
    let r = mount!(r, "/wallet-accounts", wallet_accounts);
    let r = mount!(r, "/wallet-transactions", wallet_transactions);
    let r = mount!(r, "/loans", loans);
    let r = mount!(r, "/inventory", inventory);
    let r = mount!(r, "/shop-purchase-history", shop_purchase_history);
    let r = mount!(r, "/job-listings", job_listings);
    let r = mount!(r, "/interviews", interviews);
    let r = mount!(r, "/contact-storylines", contact_storylines);
    let r = mount!(r, "/contact-save-snapshots", contact_save_snapshots);
    let r = mount!(r, "/global-save-snapshots", global_save_snapshots);
    mount!(r, "/speech-cache", speech_cache)
}
