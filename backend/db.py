"""SQLite storage. Everything lives in data/money.db (ignored by git)."""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("FINANCE_DB", ROOT / "data" / "money.db"))

ACCOUNT_TYPES = ["Checking", "Savings", "Credit Card", "Cash", "Loan", "Investment", "Other"]
LIABILITY_TYPES = {"Credit Card", "Loan"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY,
    plaid_item_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,            -- encrypted with the key in .env
    institution_id TEXT,
    institution_name TEXT NOT NULL DEFAULT 'Bank',
    cursor TEXT,
    last_synced TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    institution TEXT NOT NULL DEFAULT '',
    mask TEXT,
    opening_balance REAL NOT NULL DEFAULT 0,
    current_balance REAL,                  -- set for bank-linked accounts; debts are negative
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    plaid_account_id TEXT UNIQUE,
    hidden INTEGER NOT NULL DEFAULT 0,
    is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'expense',  -- expense | income | transfer
    emoji TEXT NOT NULL DEFAULT '📦',
    color TEXT NOT NULL DEFAULT '#94a3b8',
    budget REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    merchant TEXT,
    amount REAL NOT NULL,                  -- negative = money out
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    pending INTEGER NOT NULL DEFAULT 0,
    reviewed INTEGER NOT NULL DEFAULT 0,
    logo_url TEXT,
    plaid_transaction_id TEXT UNIQUE,
    import_hash TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL UNIQUE COLLATE NOCASE,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    lender TEXT NOT NULL DEFAULT '',
    balance REAL NOT NULL,
    apr REAL NOT NULL DEFAULT 0,
    min_payment REAL NOT NULL DEFAULT 0,
    due_day INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    account_id INTEGER UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,  -- set when synced from a bank
    is_demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_CATEGORIES = [  # name, kind, emoji, color
    ("Income", "income", "💰", "#22c55e"),
    ("Transfer", "transfer", "🔁", "#94a3b8"),
    ("Groceries", "expense", "🛒", "#84cc16"),
    ("Dining", "expense", "🍔", "#f97316"),
    ("Transport", "expense", "🚗", "#0ea5e9"),
    ("Shopping", "expense", "🛍️", "#ec4899"),
    ("Housing", "expense", "🏠", "#8b5cf6"),
    ("Bills & Utilities", "expense", "💡", "#eab308"),
    ("Subscriptions", "expense", "📺", "#6366f1"),
    ("Health", "expense", "💊", "#14b8a6"),
    ("Personal Care", "expense", "💇", "#d946ef"),
    ("Entertainment", "expense", "🎬", "#f43f5e"),
    ("Travel", "expense", "✈️", "#06b6d4"),
    ("Education", "expense", "📚", "#3b82f6"),
    ("Gifts & Donations", "expense", "🎁", "#e11d48"),
    ("Debt Payments", "expense", "💳", "#64748b"),
    ("Fees", "expense", "🧾", "#78716c"),
    ("Other", "expense", "📦", "#a8a29e"),
]


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    with connect() as con:
        con.executescript(SCHEMA)
        if not con.execute("SELECT 1 FROM categories LIMIT 1").fetchone():
            con.executemany("INSERT INTO categories(name, kind, emoji, color) VALUES (?, ?, ?, ?)",
                            DEFAULT_CATEGORIES)


def rows(sql, params=()):
    with connect() as con:
        return [dict(r) for r in con.execute(sql, params).fetchall()]


def row(sql, params=()):
    with connect() as con:
        r = con.execute(sql, params).fetchone()
    return dict(r) if r else None


def execute(sql, params=()):
    with connect() as con:
        return con.execute(sql, params).lastrowid


def get_setting(key, default=""):
    r = row("SELECT value FROM settings WHERE key = ?", (key,))
    return r["value"] if r else default


def set_setting(key, value):
    execute("INSERT INTO settings(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))


# ---------- rules ----------

def rule_list(con):
    found = con.execute("SELECT pattern, category_id FROM rules").fetchall()
    return sorted(((r[0], r[1]) for r in found), key=lambda r: -len(r[0]))  # most specific wins


def match_rule(text, rules):
    text = text.lower()
    for pattern, category_id in rules:
        if pattern.lower() in text:
            return category_id
    return None


def apply_rule(con, pattern, category_id, only_uncategorized=False):
    sql = ("UPDATE transactions SET category_id = ? "
           "WHERE instr(lower(COALESCE(merchant, '') || ' ' || description), lower(?)) > 0")
    if only_uncategorized:
        sql += " AND category_id IS NULL"
    return con.execute(sql, (category_id, pattern)).rowcount


# ---------- shared queries ----------

ACCOUNT_SELECT = """
SELECT a.*, i.institution_name AS item_institution, i.last_synced, i.error AS item_error,
       CASE WHEN a.current_balance IS NOT NULL THEN a.current_balance
            ELSE a.opening_balance + COALESCE((SELECT SUM(t.amount) FROM transactions t
                                               WHERE t.account_id = a.id), 0) END AS balance,
       (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS transaction_count
FROM accounts a LEFT JOIN items i ON i.id = a.item_id
"""

TRANSACTION_SELECT = """
SELECT t.id, t.date, t.description, t.merchant, t.amount, t.notes, t.pending, t.reviewed, t.logo_url,
       t.category_id, c.name AS category, c.emoji AS category_emoji, c.color AS category_color, c.kind,
       t.account_id, a.name AS account, a.mask AS account_mask, a.institution AS account_institution,
       t.plaid_transaction_id IS NOT NULL AS from_bank
FROM transactions t
JOIN accounts a ON a.id = t.account_id
LEFT JOIN categories c ON c.id = t.category_id
"""
