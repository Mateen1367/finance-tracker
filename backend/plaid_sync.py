"""Bank connections through Plaid.

Flow: the browser opens Plaid Link with a link token -> you log in to your bank inside Plaid's window ->
Plaid gives the browser a one-time public token -> we swap it for a read-only access token, encrypt it,
and store it. Your bank password never reaches this app."""
import datetime as dt
import time

import plaid
from plaid.api import plaid_api
from plaid.model.accounts_get_request import AccountsGetRequest
from plaid.model.country_code import CountryCode
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.liabilities_get_request import LiabilitiesGetRequest
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.link_token_transactions import LinkTokenTransactions
from plaid.model.products import Products
from plaid.model.transactions_sync_request import TransactionsSyncRequest

from . import config, db

# Plaid's categories -> ours. Checked as "DETAILED" first, then "PRIMARY".
PLAID_CATEGORY_MAP = {
    "FOOD_AND_DRINK_GROCERIES": "Groceries",
    "RENT_AND_UTILITIES_RENT": "Housing",
    "GENERAL_SERVICES_EDUCATION": "Education",
    "GENERAL_SERVICES_INSURANCE": "Bills & Utilities",
    "ENTERTAINMENT_TV_AND_MOVIES": "Subscriptions",
    "ENTERTAINMENT_MUSIC_AND_AUDIO": "Subscriptions",
    "INCOME": "Income",
    "TRANSFER_IN": "Transfer",
    "TRANSFER_OUT": "Transfer",
    "LOAN_PAYMENTS": "Debt Payments",
    "BANK_FEES": "Fees",
    "ENTERTAINMENT": "Entertainment",
    "FOOD_AND_DRINK": "Dining",
    "GENERAL_MERCHANDISE": "Shopping",
    "HOME_IMPROVEMENT": "Housing",
    "MEDICAL": "Health",
    "PERSONAL_CARE": "Personal Care",
    "GENERAL_SERVICES": "Bills & Utilities",
    "GOVERNMENT_AND_NON_PROFIT": "Gifts & Donations",
    "TRANSPORTATION": "Transport",
    "TRAVEL": "Travel",
    "RENT_AND_UTILITIES": "Bills & Utilities",
}

ACCOUNT_TYPE_MAP = {"credit": "Credit Card", "loan": "Loan", "investment": "Investment", "brokerage": "Investment"}


class PlaidNotConfigured(Exception):
    pass


def _client():
    if not config.plaid_configured():
        raise PlaidNotConfigured("Add PLAID_CLIENT_ID and PLAID_SECRET to the .env file first.")
    host = plaid.Environment.Production if config.PLAID_ENV == "production" else plaid.Environment.Sandbox
    configuration = plaid.Configuration(host=host, api_key={
        "clientId": config.PLAID_CLIENT_ID, "secret": config.PLAID_SECRET,
    })
    return plaid_api.PlaidApi(plaid.ApiClient(configuration))


def create_link_token():
    request = LinkTokenCreateRequest(
        user=LinkTokenCreateRequestUser(client_user_id="owner"),
        client_name="My Money",
        products=[Products("transactions")],
        required_if_supported_products=[Products("liabilities")],
        transactions=LinkTokenTransactions(days_requested=730),
        country_codes=[CountryCode("US")],
        language="en",
    )
    return _client().link_token_create(request)["link_token"]


def exchange_public_token(public_token, institution_id=None, institution_name=None):
    response = _client().item_public_token_exchange(ItemPublicTokenExchangeRequest(public_token=public_token))
    item_id = db.execute(
        """INSERT INTO items(plaid_item_id, access_token, institution_id, institution_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(plaid_item_id) DO UPDATE SET access_token = excluded.access_token, error = NULL""",
        (response["item_id"], config.encrypt(response["access_token"]), institution_id,
         institution_name or "Bank"),
    )
    item = db.row("SELECT * FROM items WHERE plaid_item_id = ?", (response["item_id"],))
    sync_item(item, first_sync=True)
    return item_id


def remove_item(item_id):
    item = db.row("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        return
    try:
        _client().item_remove(ItemRemoveRequest(access_token=config.decrypt(item["access_token"])))
    except Exception:
        pass  # still forget it locally even if Plaid already removed it
    with db.connect() as con:
        con.execute("DELETE FROM items WHERE id = ?", (item_id,))


def sync_all(max_age_seconds=0):
    """Sync every connected bank. With max_age_seconds, skip banks synced more recently than that."""
    results = []
    now = dt.datetime.now(dt.timezone.utc)
    for item in db.rows("SELECT * FROM items"):
        if max_age_seconds and item["last_synced"]:
            age = (now - dt.datetime.fromisoformat(item["last_synced"])).total_seconds()
            if age < max_age_seconds:
                continue
        results.append(sync_item(item))
    return results


def sync_item(item, first_sync=False):
    client = _client()
    access_token = config.decrypt(item["access_token"])
    try:
        accounts = client.accounts_get(AccountsGetRequest(access_token=access_token)).to_dict()["accounts"]
        upsert_accounts(item, accounts)

        cursor = item["cursor"]
        added, modified, removed = [], [], []
        attempts = 0
        while True:
            kwargs = {"access_token": access_token}
            if cursor:
                kwargs["cursor"] = cursor
            page = client.transactions_sync(TransactionsSyncRequest(**kwargs)).to_dict()
            # Right after connecting, Plaid may still be pulling history; wait briefly for it.
            if (first_sync and not cursor and not page["added"] and attempts < 8
                    and str(page.get("transactions_update_status", "")) == "NOT_READY"):
                attempts += 1
                time.sleep(2)
                continue
            added += page["added"]
            modified += page["modified"]
            removed += page["removed"]
            cursor = page["next_cursor"]
            if not page["has_more"]:
                break
        counts = apply_transaction_changes(added, modified, removed)

        try:
            liabilities = client.liabilities_get(LiabilitiesGetRequest(access_token=access_token)).to_dict()
            upsert_liabilities(liabilities.get("liabilities") or {})
        except plaid.ApiException:
            pass  # this bank doesn't offer loan/credit details

        with db.connect() as con:
            con.execute("UPDATE items SET cursor = ?, last_synced = ?, error = NULL WHERE id = ?",
                        (cursor, dt.datetime.now(dt.timezone.utc).isoformat(), item["id"]))
        return {"institution": item["institution_name"], **counts}
    except plaid.ApiException as e:
        message = _plaid_error_message(e)
        db.execute("UPDATE items SET error = ? WHERE id = ?", (message, item["id"]))
        return {"institution": item["institution_name"], "error": message}


def _plaid_error_message(e):
    try:
        import json
        body = json.loads(e.body)
        if body.get("error_code") == "ITEM_LOGIN_REQUIRED":
            return "Your bank needs you to log in again. Remove and reconnect it."
        return body.get("display_message") or body.get("error_message") or str(e)
    except Exception:
        return str(e)


def upsert_accounts(item, accounts):
    with db.connect() as con:
        for a in accounts:
            plaid_type, subtype = str(a["type"]), str(a.get("subtype") or "")
            if plaid_type == "depository":
                type_ = "Savings" if subtype in ("savings", "money market", "cd") else "Checking"
            else:
                type_ = ACCOUNT_TYPE_MAP.get(plaid_type, "Other")
            balances = a["balances"]
            current = balances.get("current")
            if current is None:
                current = balances.get("available") or 0
            if type_ in db.LIABILITY_TYPES:
                current = -abs(current)  # money owed counts against net worth
            con.execute(
                """INSERT INTO accounts(name, type, institution, mask, current_balance, item_id, plaid_account_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(plaid_account_id) DO UPDATE SET
                       current_balance = excluded.current_balance, mask = excluded.mask""",
                (a.get("name") or a.get("official_name") or "Account", type_, item["institution_name"],
                 a.get("mask"), current, item["id"], a["account_id"]),
            )


def _category_for(tx, rules, categories):
    text = f"{tx.get('merchant_name') or ''} {tx.get('name') or ''}"
    by_rule = db.match_rule(text, rules)
    if by_rule:
        return by_rule
    pfc = tx.get("personal_finance_category") or {}
    for key in (pfc.get("detailed"), pfc.get("primary")):
        if key and PLAID_CATEGORY_MAP.get(key) in categories:
            return categories[PLAID_CATEGORY_MAP[key]]
    return None


def apply_transaction_changes(added, modified, removed):
    with db.connect() as con:
        rules = db.rule_list(con)
        categories = {r["name"]: r["id"] for r in con.execute("SELECT id, name FROM categories")}
        account_ids = {r["plaid_account_id"]: r["id"]
                       for r in con.execute("SELECT id, plaid_account_id FROM accounts WHERE plaid_account_id IS NOT NULL")}
        inserted = updated = 0
        for tx in added + modified:
            account_id = account_ids.get(tx["account_id"])
            if account_id is None:
                continue
            values = (account_id, str(tx["date"]), tx.get("name") or "", tx.get("merchant_name"),
                      -float(tx["amount"]),  # Plaid: positive = money out. Ours: negative = money out.
                      int(bool(tx.get("pending"))), tx.get("logo_url"))
            existing = con.execute("SELECT id FROM transactions WHERE plaid_transaction_id = ?",
                                   (tx["transaction_id"],)).fetchone()
            if existing:
                # Keep the user's category and notes; refresh what the bank may have changed.
                con.execute("""UPDATE transactions SET account_id = ?, date = ?, description = ?, merchant = ?,
                               amount = ?, pending = ?, logo_url = ? WHERE id = ?""", values + (existing[0],))
                updated += 1
            else:
                con.execute("""INSERT INTO transactions(account_id, date, description, merchant, amount, pending,
                               logo_url, category_id, plaid_transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                            values + (_category_for(tx, rules, categories), tx["transaction_id"]))
                inserted += 1
        for tx in removed:
            con.execute("DELETE FROM transactions WHERE plaid_transaction_id = ?", (tx["transaction_id"],))
    return {"added": inserted, "updated": updated, "removed": len(removed)}


def upsert_liabilities(liabilities):
    """Turn credit cards, student loans and mortgages reported by the bank into Debts entries."""
    with db.connect() as con:
        accounts = {r["plaid_account_id"]: dict(r) for r in con.execute(
            "SELECT id, plaid_account_id, name, institution, current_balance FROM accounts "
            "WHERE plaid_account_id IS NOT NULL")}

        def save(plaid_account_id, apr, min_payment, due_date):
            account = accounts.get(plaid_account_id)
            if not account:
                return
            due_day = dt.date.fromisoformat(str(due_date)).day if due_date else None
            con.execute(
                """INSERT INTO debts(name, lender, balance, apr, min_payment, due_day, account_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(account_id) DO UPDATE SET balance = excluded.balance, apr = excluded.apr,
                       min_payment = excluded.min_payment, due_day = COALESCE(excluded.due_day, debts.due_day)""",
                (account["name"], account["institution"], abs(account["current_balance"] or 0), apr or 0,
                 min_payment or 0, due_day, account["id"]),
            )

        for card in liabilities.get("credit") or []:
            aprs = card.get("aprs") or []
            purchase = next((a for a in aprs if str(a.get("apr_type")) == "purchase_apr"), aprs[0] if aprs else {})
            save(card["account_id"], purchase.get("apr_percentage"), card.get("minimum_payment_amount"),
                 card.get("next_payment_due_date"))
        for loan in liabilities.get("student") or []:
            save(loan["account_id"], loan.get("interest_rate_percentage"), loan.get("minimum_payment_amount"),
                 loan.get("next_payment_due_date"))
        for loan in liabilities.get("mortgage") or []:
            rate = (loan.get("interest_rate") or {}).get("percentage")
            save(loan["account_id"], rate, loan.get("next_monthly_payment"), loan.get("next_payment_due_date"))
