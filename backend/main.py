"""API server for the app. Run from the project folder:  python -m uvicorn backend.main:app --port 8501"""
import datetime as dt
import hashlib
import io
from typing import Optional

import pandas as pd
import plaid
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from . import config, db, demo, plaid_sync
from .finance import detect_recurring, parse_amount, simulate_payoff

db.init_db()
app = FastAPI(title="My Money")


@app.exception_handler(plaid_sync.PlaidNotConfigured)
def _plaid_not_configured(_: Request, e: Exception):
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(plaid.ApiException)
def _plaid_error(_: Request, e: plaid.ApiException):
    return JSONResponse({"detail": plaid_sync._plaid_error_message(e)}, status_code=400)


# ---------------------------------------------------------------- helpers

def today():
    return dt.date.today()


def shift_month(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return dt.date(y, m + 1, 1)


def month_start(month):
    return dt.date.fromisoformat(month + "-01") if month else today().replace(day=1)


def transactions_between(start, end):
    return db.rows(db.TRANSACTION_SELECT + " WHERE t.date >= ? AND t.date < ? ORDER BY t.date DESC, t.id DESC",
                   (start.isoformat(), end.isoformat()))


def is_income(t):
    return t["kind"] == "income" or (t["kind"] is None and t["amount"] > 0)


def totals(tx):
    """Income and spending, ignoring transfers. Refunds in a spending category reduce spending."""
    income = spending = 0.0
    for t in tx:
        if t["kind"] == "transfer":
            continue
        if is_income(t):
            income += t["amount"]
        else:
            spending -= t["amount"]
    return income, spending


def daily_cumulative(tx, start):
    days = (shift_month(start, 1) - start).days
    per_day = [0.0] * days
    for t in tx:
        if t["kind"] != "transfer" and not is_income(t):
            per_day[dt.date.fromisoformat(t["date"]).day - 1] -= t["amount"]
    running, out = 0.0, []
    for value in per_day:
        running += value
        out.append(round(running, 2))
    return out


def net_worth():
    accounts = db.rows(db.ACCOUNT_SELECT + " WHERE a.hidden = 0")
    unlinked_debt = db.row("SELECT COALESCE(SUM(balance), 0) AS s FROM debts WHERE account_id IS NULL")["s"]
    assets = sum(a["balance"] for a in accounts if a["balance"] > 0)
    liabilities = -sum(a["balance"] for a in accounts if a["balance"] < 0) + unlinked_debt
    return {"net_worth": assets - liabilities, "assets": assets, "liabilities": liabilities}


def recurring_list():
    start = shift_month(today(), -12)
    tx = db.rows(db.TRANSACTION_SELECT + " WHERE t.date >= ? AND COALESCE(c.kind, '') != 'transfer'",
                 (start.isoformat(),))
    if not tx:
        return []
    frame = pd.DataFrame(tx)
    frame["description"] = frame["merchant"].fillna(frame["description"])
    frame["date"] = pd.to_datetime(frame["date"])
    found = detect_recurring(frame)
    if found.empty:
        return []
    latest = frame.sort_values("date").groupby("description").last()
    out = []
    for r in found.to_dict("records"):
        info = latest.loc[r["merchant"]] if r["merchant"] in latest.index else None
        out.append({
            **r,
            "last_charge": r["last_charge"].isoformat(),
            "next_expected": r["next_expected"].isoformat(),
            "category": None if info is None else info["category"],
            "category_emoji": None if info is None else info["category_emoji"],
            "category_color": None if info is None else info["category_color"],
            "logo_url": None if info is None else info["logo_url"],
        })
    return out


def clean(value):
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


# ---------------------------------------------------------------- dashboard

@app.get("/api/summary")
def summary(month: Optional[str] = None):
    start = month_start(month)
    end = shift_month(start, 1)
    tx = transactions_between(start, end)
    income, spending = totals(tx)

    categories = db.rows("SELECT * FROM categories WHERE kind = 'expense'")
    spent = {}
    for t in tx:
        if t["kind"] == "transfer" or is_income(t):
            continue
        spent[t["category_id"]] = spent.get(t["category_id"], 0.0) - t["amount"]
    by_category = [
        {**c, "spent": round(spent.get(c["id"], 0.0), 2)}
        for c in categories if spent.get(c["id"], 0) > 0 or c["budget"] > 0
    ]
    if spent.get(None, 0) > 0:
        by_category.append({"id": None, "name": "Uncategorized", "emoji": "❔", "color": "#a8a29e",
                            "budget": 0, "spent": round(spent[None], 2)})
    by_category.sort(key=lambda c: -c["spent"])

    prev_start = shift_month(start, -1)
    this_daily = daily_cumulative(tx, start)
    last_daily = daily_cumulative(transactions_between(prev_start, start), prev_start)
    if start == today().replace(day=1):
        this_daily = this_daily[:today().day]

    trend = []
    for back in range(5, -1, -1):
        m = shift_month(start, -back)
        inc, spd = totals(transactions_between(m, shift_month(m, 1)))
        trend.append({"month": m.strftime("%Y-%m"), "income": round(inc, 2), "spending": round(spd, 2)})

    horizon = (today() + dt.timedelta(days=14)).isoformat()
    upcoming = [r for r in recurring_list() if today().isoformat() <= r["next_expected"] <= horizon]
    upcoming.sort(key=lambda r: r["next_expected"])

    return {
        "month": start.strftime("%Y-%m"),
        "income": round(income, 2),
        "spending": round(spending, 2),
        "budget_total": sum(c["budget"] for c in categories),
        "by_category": by_category,
        "daily": {"this_month": this_daily, "last_month": last_daily},
        "trend": trend,
        **net_worth(),
        "to_review": db.row("SELECT COUNT(*) AS n FROM transactions WHERE reviewed = 0")["n"],
        "upcoming": upcoming[:6],
        "recent": db.rows(db.TRANSACTION_SELECT + " ORDER BY t.date DESC, t.id DESC LIMIT 6"),
        "has_accounts": bool(db.row("SELECT 1 FROM accounts LIMIT 1")),
    }


# ---------------------------------------------------------------- transactions

class TransactionIn(BaseModel):
    account_id: int
    date: dt.date
    description: str
    amount: float
    category_id: Optional[int] = None
    notes: str = ""


class TransactionPatch(BaseModel):
    category_id: Optional[int] = None
    notes: Optional[str] = None
    reviewed: Optional[bool] = None
    description: Optional[str] = None
    date: Optional[dt.date] = None
    amount: Optional[float] = None
    apply_to_merchant: bool = False  # also create a rule and recategorize everything from this merchant


@app.get("/api/transactions")
def list_transactions(month: Optional[str] = None, account_id: Optional[int] = None,
                      category_id: Optional[str] = None, q: Optional[str] = None,
                      review: bool = False, limit: int = 300, offset: int = 0):
    where, params = ["1 = 1"], []
    if month:
        start = month_start(month)
        where.append("t.date >= ? AND t.date < ?")
        params += [start.isoformat(), shift_month(start, 1).isoformat()]
    if account_id:
        where.append("t.account_id = ?")
        params.append(account_id)
    if category_id == "none":
        where.append("t.category_id IS NULL")
    elif category_id:
        where.append("t.category_id = ?")
        params.append(int(category_id))
    if q:
        where.append("(t.description LIKE ? OR t.merchant LIKE ? OR t.notes LIKE ?)")
        params += [f"%{q}%"] * 3
    if review:
        where.append("t.reviewed = 0")
    sql = db.TRANSACTION_SELECT + f" WHERE {' AND '.join(where)} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?"
    return db.rows(sql, params + [limit, offset])


@app.post("/api/transactions")
def create_transaction(body: TransactionIn):
    with db.connect() as con:
        category_id = body.category_id or db.match_rule(body.description, db.rule_list(con))
        new_id = con.execute(
            """INSERT INTO transactions(account_id, date, description, merchant, amount, category_id, notes, reviewed)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
            (body.account_id, body.date.isoformat(), body.description.strip(), body.description.strip(),
             body.amount, category_id, body.notes)).lastrowid
    return db.row(db.TRANSACTION_SELECT + " WHERE t.id = ?", (new_id,))


@app.patch("/api/transactions/{tx_id}")
def update_transaction(tx_id: int, body: TransactionPatch):
    tx = db.row("SELECT * FROM transactions WHERE id = ?", (tx_id,))
    if not tx:
        raise HTTPException(404, "Transaction not found")
    fields = body.model_dump(exclude_unset=True)
    apply_to_merchant = fields.pop("apply_to_merchant", False)
    changed = 0
    with db.connect() as con:
        if "category_id" in fields:
            fields["reviewed"] = True  # choosing a category counts as reviewing it
        for key, value in fields.items():
            if key == "date":
                value = value.isoformat()
            if key == "reviewed":
                value = int(value)
            con.execute(f"UPDATE transactions SET {key} = ? WHERE id = ?", (value, tx_id))
        if apply_to_merchant and fields.get("category_id"):
            pattern = (tx["merchant"] or tx["description"]).strip()
            con.execute("INSERT INTO rules(pattern, category_id) VALUES (?, ?) "
                        "ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id",
                        (pattern, fields["category_id"]))
            changed = db.apply_rule(con, pattern, fields["category_id"])
    return {**db.row(db.TRANSACTION_SELECT + " WHERE t.id = ?", (tx_id,)), "also_updated": max(changed - 1, 0)}


@app.post("/api/transactions/review-all")
def review_all():
    with db.connect() as con:
        n = con.execute("UPDATE transactions SET reviewed = 1 WHERE reviewed = 0").rowcount
    return {"reviewed": n}


@app.delete("/api/transactions/{tx_id}")
def delete_transaction(tx_id: int):
    db.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    return {"ok": True}


# ---------------------------------------------------------------- accounts

class AccountIn(BaseModel):
    name: str
    type: str
    opening_balance: float = 0
    institution: str = ""


class AccountPatch(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    opening_balance: Optional[float] = None
    hidden: Optional[bool] = None


@app.get("/api/accounts")
def list_accounts():
    return db.rows(db.ACCOUNT_SELECT + " ORDER BY a.hidden, a.institution, a.name")


@app.post("/api/accounts")
def create_account(body: AccountIn):
    if body.type not in db.ACCOUNT_TYPES:
        raise HTTPException(400, f"Type must be one of {db.ACCOUNT_TYPES}")
    new_id = db.execute("INSERT INTO accounts(name, type, institution, opening_balance) VALUES (?, ?, ?, ?)",
                        (body.name.strip(), body.type, body.institution.strip(), body.opening_balance))
    return db.row(db.ACCOUNT_SELECT + " WHERE a.id = ?", (new_id,))


@app.patch("/api/accounts/{account_id}")
def update_account(account_id: int, body: AccountPatch):
    with db.connect() as con:
        for key, value in body.model_dump(exclude_unset=True).items():
            con.execute(f"UPDATE accounts SET {key} = ? WHERE id = ?",
                        (int(value) if key == "hidden" else value, account_id))
    return db.row(db.ACCOUNT_SELECT + " WHERE a.id = ?", (account_id,))


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: int):
    account = db.row("SELECT * FROM accounts WHERE id = ?", (account_id,))
    if account and account["item_id"]:
        raise HTTPException(400, "This account comes from a bank connection. Remove the connection instead, "
                                 "or hide the account.")
    db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    return {"ok": True}


# ---------------------------------------------------------------- categories & rules

class CategoryIn(BaseModel):
    name: str
    kind: str = "expense"
    emoji: str = "📦"
    color: str = "#94a3b8"
    budget: float = 0


class CategoryPatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    emoji: Optional[str] = None
    color: Optional[str] = None
    budget: Optional[float] = None


class RuleIn(BaseModel):
    pattern: str
    category_id: int


@app.get("/api/categories")
def list_categories():
    return db.rows("SELECT * FROM categories ORDER BY CASE kind WHEN 'expense' THEN 0 WHEN 'income' THEN 1 "
                   "ELSE 2 END, name")


@app.post("/api/categories")
def create_category(body: CategoryIn):
    try:
        new_id = db.execute("INSERT INTO categories(name, kind, emoji, color, budget) VALUES (?, ?, ?, ?, ?)",
                            (body.name.strip(), body.kind, body.emoji, body.color, body.budget))
    except Exception:
        raise HTTPException(400, "A category with that name already exists.")
    return db.row("SELECT * FROM categories WHERE id = ?", (new_id,))


@app.patch("/api/categories/{category_id}")
def update_category(category_id: int, body: CategoryPatch):
    with db.connect() as con:
        for key, value in body.model_dump(exclude_unset=True).items():
            con.execute(f"UPDATE categories SET {key} = ? WHERE id = ?", (value, category_id))
    return db.row("SELECT * FROM categories WHERE id = ?", (category_id,))


@app.delete("/api/categories/{category_id}")
def delete_category(category_id: int):
    db.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    return {"ok": True}


@app.get("/api/rules")
def list_rules():
    return db.rows("SELECT r.id, r.pattern, r.category_id, c.name AS category, c.emoji FROM rules r "
                   "JOIN categories c ON c.id = r.category_id ORDER BY r.pattern")


@app.post("/api/rules")
def create_rule(body: RuleIn):
    with db.connect() as con:
        con.execute("INSERT INTO rules(pattern, category_id) VALUES (?, ?) "
                    "ON CONFLICT(pattern) DO UPDATE SET category_id = excluded.category_id",
                    (body.pattern.strip(), body.category_id))
        n = db.apply_rule(con, body.pattern.strip(), body.category_id)
    return {"updated": n}


@app.delete("/api/rules/{rule_id}")
def delete_rule(rule_id: int):
    db.execute("DELETE FROM rules WHERE id = ?", (rule_id,))
    return {"ok": True}


# ---------------------------------------------------------------- debts

class DebtIn(BaseModel):
    name: str
    lender: str = ""
    balance: float
    apr: float = 0
    min_payment: float = 0
    due_day: Optional[int] = None
    notes: str = ""


class DebtPatch(BaseModel):
    name: Optional[str] = None
    lender: Optional[str] = None
    balance: Optional[float] = None
    apr: Optional[float] = None
    min_payment: Optional[float] = None
    due_day: Optional[int] = None
    notes: Optional[str] = None


def next_due(day):
    if not day:
        return None
    import calendar
    for n in (0, 1):
        first = shift_month(today(), n)
        due = first.replace(day=min(int(day), calendar.monthrange(first.year, first.month)[1]))
        if due >= today():
            return due.isoformat()


@app.get("/api/debts")
def list_debts():
    debts = db.rows("SELECT d.*, a.institution AS account_institution FROM debts d "
                    "LEFT JOIN accounts a ON a.id = d.account_id ORDER BY d.balance DESC")
    for d in debts:
        d["next_due"] = next_due(d["due_day"])
        d["synced"] = d["account_id"] is not None
    return debts


@app.post("/api/debts")
def create_debt(body: DebtIn):
    new_id = db.execute("INSERT INTO debts(name, lender, balance, apr, min_payment, due_day, notes) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)", tuple(body.model_dump().values()))
    return db.row("SELECT * FROM debts WHERE id = ?", (new_id,))


@app.patch("/api/debts/{debt_id}")
def update_debt(debt_id: int, body: DebtPatch):
    with db.connect() as con:
        for key, value in body.model_dump(exclude_unset=True).items():
            con.execute(f"UPDATE debts SET {key} = ? WHERE id = ?", (value, debt_id))
    return db.row("SELECT * FROM debts WHERE id = ?", (debt_id,))


@app.delete("/api/debts/{debt_id}")
def delete_debt(debt_id: int):
    db.execute("DELETE FROM debts WHERE id = ?", (debt_id,))
    return {"ok": True}


@app.get("/api/debts/plan")
def debt_plan(extra: float = 0):
    debts = db.rows("SELECT name, balance, apr, min_payment FROM debts WHERE balance > 0")

    def describe(result):
        months = result["months"]
        return {
            "months": months,
            "debt_free": None if months is None else shift_month(today(), months).isoformat(),
            "total_interest": round(result["total_interest"], 2),
            "order": [{"name": n, "month": m, "date": shift_month(today(), m).isoformat()} for n, m in result["order"]],
            "history": [{"month": int(h["month"]), "balance": round(h["balance"], 2)}
                        for h in result["history"].to_dict("records")],
        }

    return {
        "avalanche": describe(simulate_payoff(debts, extra, "avalanche")),
        "snowball": describe(simulate_payoff(debts, extra, "snowball")),
        "minimum": describe(simulate_payoff(debts, 0, "avalanche")),
    }


# ---------------------------------------------------------------- recurring

@app.get("/api/recurring")
def recurring():
    items = recurring_list()
    return {"items": items, "monthly_total": round(sum(i["monthly_cost"] for i in items), 2)}


# ---------------------------------------------------------------- CSV import

def _read_csv(data, skip_rows):
    return pd.read_csv(io.BytesIO(data), skiprows=skip_rows, dtype=str, skip_blank_lines=True).dropna(how="all")


def _guess(columns, *words):
    return next((c for c in columns if any(w in str(c).lower() for w in words)), None)


@app.post("/api/import/preview")
async def import_preview(file: UploadFile = File(...), skip_rows: int = Form(0)):
    try:
        frame = _read_csv(await file.read(), skip_rows)
    except Exception as e:
        raise HTTPException(400, f"Couldn't read that CSV ({e}). Try skipping some rows at the top.")
    cols = [str(c) for c in frame.columns]
    return {
        "columns": cols,
        "rows": frame.head(8).fillna("").to_dict("records"),
        "guess": {
            "date": _guess(cols, "date"),
            "description": _guess(cols, "desc", "narration", "details", "particular", "memo", "payee", "merchant"),
            "amount": _guess(cols, "amount"),
            "debit": _guess(cols, "debit", "withdraw", "paid out"),
            "credit": _guess(cols, "credit", "deposit", "paid in"),
        },
    }


@app.post("/api/import/commit")
async def import_commit(file: UploadFile = File(...), account_id: int = Form(...), skip_rows: int = Form(0),
                        date_col: str = Form(...), description_col: str = Form(...),
                        amount_col: Optional[str] = Form(None), debit_col: Optional[str] = Form(None),
                        credit_col: Optional[str] = Form(None), flip: bool = Form(False),
                        dayfirst: bool = Form(False)):
    frame = _read_csv(await file.read(), skip_rows)
    if amount_col:
        amounts = frame[amount_col].map(parse_amount) * (-1 if flip else 1)
    elif debit_col and credit_col:
        amounts = frame[credit_col].map(parse_amount).abs() - frame[debit_col].map(parse_amount).abs()
    else:
        raise HTTPException(400, "Pick an amount column, or both debit and credit columns.")
    dates = pd.to_datetime(frame[date_col], dayfirst=dayfirst, errors="coerce", format="mixed")
    descriptions = frame[description_col].fillna("").astype(str).str.strip()

    inserted = skipped = invalid = 0
    occurrences = {}
    with db.connect() as con:
        rules = db.rule_list(con)
        for date, description, amount in zip(dates, descriptions, amounts):
            if pd.isna(date) or not description:
                invalid += 1
                continue
            day = date.date().isoformat()
            key = f"{account_id}|{day}|{float(amount):.2f}|{description.lower()}"
            occurrences[key] = occurrences.get(key, 0) + 1  # identical rows in one file are both real
            import_hash = hashlib.sha1(f"{key}|{occurrences[key]}".encode()).hexdigest()
            cur = con.execute(
                """INSERT OR IGNORE INTO transactions(account_id, date, description, amount, category_id, import_hash)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (account_id, day, description, float(amount), db.match_rule(description, rules), import_hash))
            if cur.rowcount:
                inserted += 1
            else:
                skipped += 1
    return {"inserted": inserted, "duplicates": skipped, "invalid": invalid}


# ---------------------------------------------------------------- bank connections

class ExchangeIn(BaseModel):
    public_token: str
    institution_id: Optional[str] = None
    institution_name: Optional[str] = None


class PlaidKeysIn(BaseModel):
    client_id: str
    secret: str
    env: str = "sandbox"


@app.put("/api/plaid/keys")
def save_plaid_keys(body: PlaidKeysIn):
    if body.env not in ("sandbox", "production"):
        raise HTTPException(400, "Environment must be sandbox or production.")
    if not body.client_id.strip() or not body.secret.strip():
        raise HTTPException(400, "Both the client ID and the secret are required.")
    config.save_plaid_keys(body.client_id, body.secret, body.env)
    return get_settings()


@app.get("/api/items")
def list_items():
    return db.rows("SELECT i.id, i.institution_name, i.last_synced, i.error, "
                   "(SELECT COUNT(*) FROM accounts a WHERE a.item_id = i.id) AS account_count FROM items i")


@app.post("/api/plaid/link-token")
def link_token():
    return {"link_token": plaid_sync.create_link_token()}


@app.post("/api/plaid/exchange")
def exchange(body: ExchangeIn):
    plaid_sync.exchange_public_token(body.public_token, body.institution_id, body.institution_name)
    return {"ok": True}


@app.post("/api/plaid/sync")
def sync(max_age: int = 0):
    if not config.plaid_configured():
        return {"results": []}
    return {"results": plaid_sync.sync_all(max_age)}


@app.delete("/api/items/{item_id}")
def delete_item(item_id: int):
    plaid_sync.remove_item(item_id)
    return {"ok": True}


# ---------------------------------------------------------------- settings, demo, export

class SettingsIn(BaseModel):
    currency: Optional[str] = None
    name: Optional[str] = None


@app.get("/api/settings")
def get_settings():
    return {
        "currency": db.get_setting("currency", "$"),
        "name": db.get_setting("name", ""),
        "plaid": {"configured": config.plaid_configured(), "env": config.PLAID_ENV},
        "demo": bool(db.row("SELECT 1 FROM accounts WHERE is_demo = 1")),
        "account_types": db.ACCOUNT_TYPES,
    }


@app.put("/api/settings")
def put_settings(body: SettingsIn):
    for key, value in body.model_dump(exclude_unset=True).items():
        db.set_setting(key, value)
    return get_settings()


@app.post("/api/demo")
def load_demo():
    demo.load_demo()
    return {"ok": True}


@app.delete("/api/demo")
def remove_demo():
    demo.remove_demo()
    return {"ok": True}


@app.get("/api/export.csv")
def export_csv():
    frame = pd.DataFrame(db.rows(db.TRANSACTION_SELECT + " ORDER BY t.date DESC"))
    cols = ["date", "account", "merchant", "description", "amount", "category", "notes", "pending"]
    data = frame[cols].to_csv(index=False) if not frame.empty else ",".join(cols) + "\n"
    return Response(data, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="transactions-{today()}.csv"'})


# ---------------------------------------------------------------- the web app itself

DIST = (config.ROOT / "web" / "dist").resolve()


@app.get("/{path:path}", include_in_schema=False)
def web_app(path: str):
    if not DIST.exists():
        return JSONResponse({"detail": "Web app not built yet. Run: npm run build (in the web folder)."}, 404)
    target = (DIST / path).resolve()
    if path and target.is_file() and DIST in target.parents:
        return FileResponse(target)
    return FileResponse(DIST / "index.html")
