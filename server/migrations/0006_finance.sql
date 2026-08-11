-- Finance: wallet accounts, idempotent ledger transactions, loans.

CREATE TABLE wallet_accounts (
    owner_id TEXT PRIMARY KEY,     -- contactId or literal 'user'
    balance INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE wallet_transactions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT,          -- unique when present: retries return the original row
    kind TEXT NOT NULL,            -- migration | salary | purchase | transfer | red_packet | loan | repayment | admin_adjustment
    from_owner_id TEXT,
    to_owner_id TEXT,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,          -- completed | reserved | cancelled
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_wallet_transactions_idempotency ON wallet_transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_wallet_transactions_from ON wallet_transactions(from_owner_id, created_at);
CREATE INDEX idx_wallet_transactions_to ON wallet_transactions(to_owner_id, created_at);

CREATE TABLE loans (
    id TEXT PRIMARY KEY,
    lender_id TEXT NOT NULL,       -- contactId or literal 'user'
    borrower_id TEXT NOT NULL,
    status TEXT NOT NULL,          -- pending | active | rejected | repaid
    created_at INTEGER NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX idx_loans_parties ON loans(lender_id, borrower_id, status);
