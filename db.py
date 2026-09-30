"""SQLite storage layer. All data lives in data/finance.db next to this file."""
import hashlib
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pandas as pd

DB_PATH = Path(os.environ.get("FINANCE_DB", Path(__file__).parent / "data" / "finance.db"))

ACCOUNT_TYPES = ["Checking", "Savings", "Credit Card", "Cash", "Wallet", "Loan", "Investment"]
CATEGORY_KINDS = ["expense", "income", "transfer"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    opening_balance REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'expense',
    budget REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    import_hash TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY,
    pattern TEXT NOT NULL,
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
    notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_CATEGORIES = [
    ("Income", "income"),
    ("Transfer", "transfer"),
    ("Groceries", "expense"),
    ("Dining", "expense"),
    ("Transport", "expense"),
    ("Shopping", "expense"),
    ("Housing", "expense"),
    ("Bills & Utilities", "expense"),
    ("Subscriptions", "expense"),
    ("Health", "expense"),
    ("Entertainment", "expense"),
    ("Travel", "expense"),
    ("Education", "expense"),
    ("Debt Payments", "expense"),
    ("Fees", "expense"),
    ("Other", "expense"),
]


@contextmanager
def connect():
    DB_PATH.parent.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_PATH)
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
            con.executemany("INSERT INTO categories(name, kind) VALUES (?, ?)", DEFAULT_CATEGORIES)


def query(sql, params=()):
    with connect() as con:
        return pd.read_sql_query(sql, con, params=list(params))


def execute(sql, params=()):
    with connect() as con:
        return con.execute(sql, params).lastrowid


def _clean(value):
    """Convert pandas/numpy values into plain Python values sqlite understands."""
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):
        return value.item()
    return value


def sync_table(table, edited, columns, required=(), defaults=None):
    """Make `table` match an edited DataFrame: rows without an id are inserted,
    rows with an id are updated, and ids that disappeared are deleted."""
    defaults = defaults or {}
    with connect() as con:
        existing = {row[0] for row in con.execute(f"SELECT id FROM {table}")}
        kept = set()
        for row in edited.to_dict("records"):
            rid = _clean(row.get("id"))
            if rid is not None:
                kept.add(int(rid))
            values = {c: _clean(row.get(c)) for c in columns}
            for col, default in defaults.items():
                if values.get(col) is None:
                    values[col] = default
            if any(values[c] in (None, "") for c in required):
                continue
            if rid is None:
                con.execute(
                    f"INSERT INTO {table}({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))})",
                    [values[c] for c in columns],
                )
            else:
                con.execute(
                    f"UPDATE {table} SET {', '.join(f'{c} = ?' for c in columns)} WHERE id = ?",
                    [values[c] for c in columns] + [int(rid)],
                )
        for rid in existing - kept:
            con.execute(f"DELETE FROM {table} WHERE id = ?", (rid,))


# ---------- settings ----------

def get_setting(key, default=""):
    with connect() as con:
        row = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row[0] if row else default


def set_setting(key, value):
    execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


# ---------- accounts ----------

def accounts():
    return query(
        """SELECT a.id, a.name, a.type, a.opening_balance,
                  a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance,
                  COUNT(t.id) AS transactions
           FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
           GROUP BY a.id ORDER BY a.name"""
    )


def add_account(name, type_, opening_balance):
    return execute(
        "INSERT INTO accounts(name, type, opening_balance) VALUES (?, ?, ?)",
        (name.strip(), type_, float(opening_balance)),
    )


def update_accounts(edited):
    with connect() as con:
        for row in edited.to_dict("records"):
            con.execute(
                "UPDATE accounts SET name = ?, type = ?, opening_balance = ? WHERE id = ?",
                (str(row["name"]).strip(), row["type"], float(_clean(row["opening_balance"]) or 0), int(row["id"])),
            )


def delete_account(account_id):
    execute("DELETE FROM accounts WHERE id = ?", (int(account_id),))


# ---------- categories & rules ----------

def categories():
    return query("SELECT id, name, kind, budget FROM categories ORDER BY kind, name")


def save_categories(edited):
    sync_table("categories", edited, ["name", "kind", "budget"], required=["name"],
               defaults={"kind": "expense", "budget": 0})


def rules():
    return query(
        """SELECT r.id, r.pattern, c.name AS category
           FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.pattern"""
    )


def _rule_list(con):
    rows = con.execute("SELECT pattern, category_id FROM rules").fetchall()
    return sorted(rows, key=lambda r: -len(r[0]))  # longest (most specific) pattern wins


def match_category(description, rule_list):
    text = description.lower()
    for pattern, category_id in rule_list:
        if pattern.lower() in text:
            return category_id
    return None


def add_rule(pattern, category_id, apply_to_uncategorized=True):
    """Add a 'description contains X -> category' rule. Returns how many existing rows it categorized."""
    pattern = pattern.strip()
    with connect() as con:
        con.execute("INSERT INTO rules(pattern, category_id) VALUES (?, ?)", (pattern, int(category_id)))
        if not apply_to_uncategorized:
            return 0
        return con.execute(
            """UPDATE transactions SET category_id = ?
               WHERE category_id IS NULL AND instr(lower(description), lower(?)) > 0""",
            (int(category_id), pattern),
        ).rowcount


def delete_rule(rule_id):
    execute("DELETE FROM rules WHERE id = ?", (int(rule_id),))


# ---------- transactions ----------

def add_transaction(account_id, date, description, amount, category_id=None, notes=""):
    with connect() as con:
        if category_id is None:
            category_id = match_category(description, _rule_list(con))
        con.execute(
            """INSERT INTO transactions(account_id, date, description, amount, category_id, notes)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (int(account_id), str(date), description.strip(), float(amount), category_id, notes or ""),
        )


def import_transactions(account_id, rows):
    """Insert parsed rows (date as YYYY-MM-DD, description, amount).
    Re-importing the same statement is safe: duplicates are detected by hash.
    Returns (inserted, skipped)."""
    inserted = skipped = 0
    occurrences = {}
    with connect() as con:
        rule_list = _rule_list(con)
        for r in rows.itertuples(index=False):
            description = str(r.description).strip()
            key = f"{account_id}|{r.date}|{float(r.amount):.2f}|{description.lower()}"
            # Two identical rows in one statement are both real, so count occurrences.
            occurrences[key] = occurrences.get(key, 0) + 1
            import_hash = hashlib.sha1(f"{key}|{occurrences[key]}".encode()).hexdigest()
            cur = con.execute(
                """INSERT OR IGNORE INTO transactions(account_id, date, description, amount, category_id, import_hash)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (int(account_id), r.date, description, float(r.amount),
                 match_category(description, rule_list), import_hash),
            )
            if cur.rowcount:
                inserted += 1
            else:
                skipped += 1
    return inserted, skipped


def transactions(start=None, end=None, account_id=None):
    """Transactions with start <= date < end (either bound optional)."""
    sql = """SELECT t.id, t.date, t.description, t.amount, t.category_id, c.name AS category,
                    c.kind, t.account_id, a.name AS account, t.notes
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id
             LEFT JOIN categories c ON c.id = t.category_id
             WHERE 1 = 1"""
    params = []
    if start:
        sql += " AND t.date >= ?"
        params.append(str(start))
    if end:
        sql += " AND t.date < ?"
        params.append(str(end))
    if account_id:
        sql += " AND t.account_id = ?"
        params.append(int(account_id))
    sql += " ORDER BY t.date DESC, t.id DESC"
    df = query(sql, params)
    df["date"] = pd.to_datetime(df["date"])
    return df


def update_transactions(rows):
    """rows: iterable of (date, description, amount, category_id, notes, id)."""
    with connect() as con:
        con.executemany(
            "UPDATE transactions SET date = ?, description = ?, amount = ?, category_id = ?, notes = ? WHERE id = ?",
            [tuple(_clean(v) for v in row) for row in rows],
        )


def delete_transactions(ids):
    with connect() as con:
        con.executemany("DELETE FROM transactions WHERE id = ?", [(int(i),) for i in ids])


# ---------- debts ----------

def debts():
    return query("SELECT id, name, lender, balance, apr, min_payment, due_day, notes FROM debts ORDER BY name")


def save_debts(edited):
    sync_table("debts", edited, ["name", "lender", "balance", "apr", "min_payment", "due_day", "notes"],
               required=["name", "balance"], defaults={"lender": "", "apr": 0, "min_payment": 0, "notes": ""})
