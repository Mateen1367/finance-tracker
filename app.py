"""Personal finance tracker. Run with:  streamlit run app.py"""
import calendar
import datetime as dt
import sqlite3

import pandas as pd
import plotly.express as px
import streamlit as st

import db
from finance import detect_recurring, parse_amount, simulate_payoff

st.set_page_config(page_title="Finance Tracker", page_icon="💰", layout="wide")
db.init_db()

CUR = db.get_setting("currency", "$")
TEAL, CORAL = "#1b9e77", "#e8684a"


def money(x):
    return f"{'-' if x < 0 else ''}{CUR}{abs(x):,.2f}"


def md_money(x):
    """money() for markdown text, where a bare $ would start a math formula."""
    return money(x).replace("$", "\\$")


def shift_month(d, n):
    y, m = divmod(d.year * 12 + d.month - 1 + n, 12)
    return dt.date(y, m + 1, 1)


def month_bounds(month):
    start = dt.date.fromisoformat(month + "-01")
    return start, shift_month(start, 1)


def month_label(month):
    return dt.date.fromisoformat(month + "-01").strftime("%B %Y")


def month_options():
    months = set(db.query("SELECT DISTINCT substr(date, 1, 7) AS m FROM transactions")["m"])
    months.add(dt.date.today().strftime("%Y-%m"))
    return sorted(months, reverse=True)


def need_accounts():
    if db.accounts().empty:
        st.info("Add an account on the **Accounts** page first (or load demo data in **Settings**).")
        return True
    return False


# ---------------------------------------------------------------- pages

def page_dashboard():
    st.title("Dashboard")
    if need_accounts():
        return
    accts, debts = db.accounts(), db.debts()
    month = st.selectbox("Month", month_options(), format_func=month_label)
    start, end = month_bounds(month)
    tx = db.transactions(start, end)
    real = tx[tx["kind"] != "transfer"]  # transfers between your own accounts aren't income or spending
    income = real.loc[real["amount"] > 0, "amount"].sum()
    spending = -real.loc[real["amount"] < 0, "amount"].sum()
    total_debt = debts["balance"].sum() if not debts.empty else 0.0

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Income", money(income))
    c2.metric("Spending", money(spending))
    c3.metric("Saved", money(income - spending),
              f"{(income - spending) / income:.0%} savings rate" if income else None)
    c4.metric("Net worth", money(accts["balance"].sum() - total_debt),
              help="Sum of account balances minus the Debts page.")

    uncategorized = tx["category_id"].isna().sum()
    if uncategorized:
        st.warning(f"{uncategorized} transactions this month are uncategorized. Fix them on **Transactions**, "
                   "or add a rule on **Categories & Budgets**.")

    left, right = st.columns(2)
    spend = real[real["amount"] < 0].copy()
    spend["category"] = spend["category"].fillna("Uncategorized")
    with left:
        st.subheader("Where the money went")
        if spend.empty:
            st.caption("No spending this month.")
        else:
            by_cat = spend.groupby("category")["amount"].sum().mul(-1).sort_values(ascending=False).reset_index()
            fig = px.bar(by_cat, x="amount", y="category", orientation="h", color_discrete_sequence=[CORAL],
                         labels={"amount": "", "category": ""})
            fig.update_layout(yaxis={"autorange": "reversed"}, height=40 + 32 * len(by_cat),
                              margin=dict(l=0, r=0, t=0, b=0))
            st.plotly_chart(fig, width="stretch")
    with right:
        st.subheader("Budgets")
        cats = db.categories()
        budgeted = cats[cats["budget"] > 0]
        if budgeted.empty:
            st.caption("Set monthly budgets on **Categories & Budgets**.")
        spent_by_cat = spend.groupby("category_id")["amount"].sum().mul(-1)
        for c in budgeted.itertuples():
            spent = spent_by_cat.get(c.id, 0.0)
            ratio = spent / c.budget
            label = f"{c.name}: {md_money(spent)} of {md_money(c.budget)}"
            st.progress(min(ratio, 1.0), text=f"{'🔴 ' if ratio > 1 else ''}{label}")

    st.subheader("Last 6 months")
    history = db.transactions(shift_month(start, -5), end)
    history = history[history["kind"] != "transfer"]
    if not history.empty:
        history["month"] = history["date"].dt.strftime("%Y-%m")
        trend = pd.DataFrame({
            "Income": history[history["amount"] > 0].groupby("month")["amount"].sum(),
            "Spending": -history[history["amount"] < 0].groupby("month")["amount"].sum(),
        }).fillna(0).reset_index().melt(id_vars="month", var_name="type", value_name="amount")
        fig = px.bar(trend, x="month", y="amount", color="type", barmode="group",
                     color_discrete_map={"Income": TEAL, "Spending": CORAL}, labels={"month": "", "amount": ""})
        fig.update_layout(height=320, margin=dict(l=0, r=0, t=0, b=0), legend_title_text="")
        st.plotly_chart(fig, width="stretch")

    st.subheader("Accounts")
    st.dataframe(
        accts[["name", "type", "balance"]].assign(balance=accts["balance"].map(money)),
        hide_index=True, width="stretch",
    )


def page_transactions():
    st.title("Transactions")
    if need_accounts():
        return
    accts, cats = db.accounts(), db.categories()
    account_ids = dict(zip(accts["name"], accts["id"]))
    category_ids = dict(zip(cats["name"], cats["id"]))

    with st.expander("➕ Add a transaction (cash, debts between friends, anything not in a statement)"):
        with st.form("add_tx", clear_on_submit=True):
            c1, c2, c3 = st.columns(3)
            date = c1.date_input("Date", dt.date.today())
            account = c2.selectbox("Account", accts["name"])
            direction = c3.radio("Type", ["Money out", "Money in"], horizontal=True)
            description = st.text_input("Description")
            c4, c5 = st.columns(2)
            amount = c4.number_input("Amount", min_value=0.0, step=1.0, format="%.2f")
            category = c5.selectbox("Category", ["(auto via rules)"] + cats["name"].tolist())
            notes = st.text_input("Notes")
            if st.form_submit_button("Add", type="primary"):
                if not description.strip() or amount == 0:
                    st.error("Description and a non-zero amount are required.")
                else:
                    db.add_transaction(account_ids[account], date, description,
                                       amount if direction == "Money in" else -amount,
                                       category_ids.get(category), notes)
                    st.success("Added.")

    f1, f2, f3, f4 = st.columns([1, 1, 1, 2])
    month = f1.selectbox("Month", ["All"] + month_options(),
                         format_func=lambda m: m if m == "All" else month_label(m))
    account = f2.selectbox("Account", ["All"] + accts["name"].tolist())
    category = f3.selectbox("Category", ["All", "Uncategorized"] + cats["name"].tolist())
    search = f4.text_input("Search description")

    start, end = month_bounds(month) if month != "All" else (None, None)
    tx = db.transactions(start, end, account_ids.get(account))
    if category == "Uncategorized":
        tx = tx[tx["category_id"].isna()]
    elif category != "All":
        tx = tx[tx["category"] == category]
    if search:
        tx = tx[tx["description"].str.contains(search, case=False, regex=False)]

    st.caption(f"{len(tx)} transactions · in {md_money(tx.loc[tx['amount'] > 0, 'amount'].sum())} · "
               f"out {md_money(-tx.loc[tx['amount'] < 0, 'amount'].sum())}. Edit cells directly, then save.")

    view = tx[["id", "date", "account", "description", "amount", "category", "notes"]].copy()
    view["date"] = view["date"].dt.date
    view["delete"] = False
    st.session_state.setdefault("tx_editor_version", 0)
    edited = st.data_editor(
        view, hide_index=True, width="stretch", disabled=["account"],
        key=f"tx_editor_{st.session_state.tx_editor_version}",
        column_config={
            "id": None,
            "date": st.column_config.DateColumn("Date", required=True),
            "account": "Account",
            "description": st.column_config.TextColumn("Description", required=True),
            "amount": st.column_config.NumberColumn("Amount", format="%.2f", required=True),
            "category": st.column_config.SelectboxColumn("Category", options=cats["name"].tolist()),
            "notes": "Notes",
            "delete": st.column_config.CheckboxColumn("Delete?"),
        },
    )
    if st.button("Save changes", type="primary"):
        keep = edited[~edited["delete"]]
        db.update_transactions(
            (str(r.date), r.description, float(r.amount), category_ids.get(r.category), r.notes or "", int(r.id))
            for r in keep.itertuples()
        )
        db.delete_transactions(edited.loc[edited["delete"], "id"])
        st.session_state.tx_editor_version += 1  # reset the editor so stale edits don't reapply
        st.rerun()


def page_import():
    st.title("Import a bank statement")
    if need_accounts():
        return
    accts = db.accounts()
    account = st.selectbox("Import into account", accts["name"])
    file = st.file_uploader("Statement file (CSV)", type=["csv"])
    st.caption("Most banks let you download transactions as CSV from their website. "
               "Re-importing an overlapping statement is safe: duplicates are skipped.")
    if not file:
        return

    skip = st.number_input("Rows to skip at the top (if your bank puts a title block above the column headers)",
                           min_value=0, max_value=50, value=0)
    try:
        file.seek(0)
        raw = pd.read_csv(file, skiprows=skip, dtype=str, skip_blank_lines=True).dropna(how="all")
    except Exception as e:
        st.error(f"Couldn't read that CSV: {e}. Try changing the rows-to-skip number.")
        return
    st.dataframe(raw.head(8), width="stretch")

    cols = raw.columns.tolist()

    def guess(*words):
        return next((i for i, c in enumerate(cols) if any(w in str(c).lower() for w in words)), 0)

    c1, c2 = st.columns(2)
    date_col = c1.selectbox("Date column", cols, index=guess("date"))
    desc_col = c2.selectbox("Description column", cols,
                            index=guess("desc", "narration", "details", "particular", "memo", "payee", "merchant"))
    layout = st.radio("How does the file show amounts?",
                      ["One amount column", "Separate debit and credit columns"], horizontal=True)
    if layout == "One amount column":
        c3, c4 = st.columns(2)
        amount_col = c3.selectbox("Amount column", cols, index=guess("amount"))
        flip = c4.checkbox("Spending shows as positive numbers (flip the signs)",
                           help="Common for credit-card statements.")
        amounts = raw[amount_col].map(parse_amount) * (-1 if flip else 1)
    else:
        c3, c4 = st.columns(2)
        debit_col = c3.selectbox("Money out (debit / withdrawal)", cols, index=guess("debit", "withdraw", "paid out"))
        credit_col = c4.selectbox("Money in (credit / deposit)", cols, index=guess("credit", "deposit", "paid in"))
        amounts = raw[credit_col].map(parse_amount).abs() - raw[debit_col].map(parse_amount).abs()
    dayfirst = st.checkbox("Dates are day-first (31/12/2025 rather than 12/31/2025)")

    dates = pd.to_datetime(raw[date_col], dayfirst=dayfirst, errors="coerce", format="mixed")
    parsed = pd.DataFrame({
        "date": dates.dt.strftime("%Y-%m-%d"),
        "description": raw[desc_col].fillna("").astype(str).str.strip(),
        "amount": amounts,
    })
    bad = parsed["date"].isna() | (parsed["description"] == "")

    st.subheader("Preview")
    st.dataframe(parsed[~bad].head(15), hide_index=True, width="stretch")
    good = parsed[~bad]
    st.write(f"**{len(good)}** rows ready · money in {md_money(good.loc[good['amount'] > 0, 'amount'].sum())} · "
             f"money out {md_money(-good.loc[good['amount'] < 0, 'amount'].sum())}")
    if bad.any():
        st.warning(f"{bad.sum()} rows have no readable date or description and will be skipped.")
    if st.button("Import", type="primary", disabled=good.empty):
        inserted, skipped = db.import_transactions(dict(zip(accts["name"], accts["id"]))[account], good)
        st.success(f"Imported {inserted} transactions" + (f", skipped {skipped} duplicates." if skipped else "."))


def page_accounts():
    st.title("Accounts")
    with st.form("add_account", clear_on_submit=True):
        c1, c2, c3 = st.columns(3)
        name = c1.text_input("Account name", placeholder="e.g. Main Checking")
        type_ = c2.selectbox("Type", db.ACCOUNT_TYPES)
        opening = c3.number_input(
            "Opening balance", value=0.0, format="%.2f",
            help="The balance before the first transaction you'll add. For a credit card, enter what you owe as a negative number.",
        )
        if st.form_submit_button("Add account", type="primary"):
            if not name.strip():
                st.error("Give the account a name.")
            else:
                try:
                    db.add_account(name, type_, opening)
                    st.success(f"Added {name}.")
                except sqlite3.IntegrityError:
                    st.error("An account with that name already exists.")

    accts = db.accounts()
    if accts.empty:
        return
    st.caption("Balance = opening balance + all transactions. Edit names, types or opening balances below.")
    edited = st.data_editor(
        accts, hide_index=True, width="stretch", disabled=["balance", "transactions"],
        column_config={
            "id": None,
            "name": st.column_config.TextColumn("Name", required=True),
            "type": st.column_config.SelectboxColumn("Type", options=db.ACCOUNT_TYPES, required=True),
            "opening_balance": st.column_config.NumberColumn("Opening balance", format="%.2f"),
            "balance": st.column_config.NumberColumn("Current balance", format="%.2f"),
            "transactions": "Transactions",
        },
    )
    if st.button("Save account changes"):
        try:
            db.update_accounts(edited)
            st.rerun()
        except sqlite3.IntegrityError:
            st.error("Two accounts can't have the same name.")

    with st.expander("Delete an account"):
        doomed = st.selectbox("Account", accts["name"], key="delete_account")
        confirm = st.checkbox(f"Yes, permanently delete {doomed} and all its transactions")
        if st.button("Delete", disabled=not confirm):
            db.delete_account(accts.loc[accts["name"] == doomed, "id"].iloc[0])
            st.rerun()


def page_categories():
    st.title("Categories & Budgets")
    cats = db.categories()
    st.caption("Set a monthly budget for any category (0 = no budget). Use kind **transfer** for moving money "
               "between your own accounts, such as paying off your credit card, so it isn't counted as spending. "
               "Add rows at the bottom of the table; select a row and press Delete to remove it.")
    edited = st.data_editor(
        cats, hide_index=True, width="stretch", num_rows="dynamic",
        column_config={
            "id": None,
            "name": st.column_config.TextColumn("Category", required=True),
            "kind": st.column_config.SelectboxColumn("Kind", options=db.CATEGORY_KINDS, required=True,
                                                     default="expense"),
            "budget": st.column_config.NumberColumn("Monthly budget", min_value=0, format="%.2f", default=0),
        },
    )
    if st.button("Save categories", type="primary"):
        try:
            db.save_categories(edited)
            st.rerun()
        except sqlite3.IntegrityError:
            st.error("Category names must be unique.")

    st.divider()
    st.subheader("Auto-categorization rules")
    st.caption("If a transaction's description contains the text, it gets the category. "
               "Rules run on every import. When several rules match, the longest one wins.")
    with st.form("add_rule", clear_on_submit=True):
        c1, c2 = st.columns(2)
        pattern = c1.text_input("If the description contains", placeholder="e.g. UBER")
        category = c2.selectbox("Set the category to", cats["name"])
        if st.form_submit_button("Add rule", type="primary") and pattern.strip():
            n = db.add_rule(pattern, cats.loc[cats["name"] == category, "id"].iloc[0])
            st.success(f"Rule added. It categorized {n} existing uncategorized transactions.")

    rules = db.rules()
    for r in rules.itertuples():
        c1, c2, c3 = st.columns([3, 3, 1])
        c1.write(f"contains **{r.pattern}**")
        c2.write(f"→ {r.category}")
        if c3.button("Remove", key=f"rule_{r.id}"):
            db.delete_rule(r.id)
            st.rerun()


def next_due(day):
    today = dt.date.today()
    for n in (0, 1):
        first = shift_month(today, n)
        due = first.replace(day=min(int(day), calendar.monthrange(first.year, first.month)[1]))
        if due >= today:
            return due


def page_debts():
    st.title("Debts")
    st.caption("Loans, money you owe people, BNPL plans and similar. Update balances whenever you make a payment. "
               "Don't add a debt here if you already track it as a negative account balance, or it will be "
               "counted twice in net worth.")
    debts = db.debts()
    edited = st.data_editor(
        debts, hide_index=True, width="stretch", num_rows="dynamic",
        column_config={
            "id": None,
            "name": st.column_config.TextColumn("Debt", required=True),
            "lender": "Lender / person",
            "balance": st.column_config.NumberColumn("Balance owed", min_value=0, format="%.2f", required=True),
            "apr": st.column_config.NumberColumn("Interest % / yr", min_value=0, format="%.2f", default=0),
            "min_payment": st.column_config.NumberColumn("Min. monthly payment", min_value=0, format="%.2f",
                                                         default=0),
            "due_day": st.column_config.NumberColumn("Due day", min_value=1, max_value=31, step=1),
            "notes": "Notes",
        },
    )
    if st.button("Save debts", type="primary"):
        db.save_debts(edited)
        st.rerun()

    debts = debts[debts["balance"] > 0]
    if debts.empty:
        return

    total = debts["balance"].sum()
    c1, c2, c3 = st.columns(3)
    c1.metric("Total owed", money(total))
    c2.metric("Minimum payments / month", money(debts["min_payment"].sum()))
    c3.metric("Average interest", f"{(debts['balance'] * debts['apr']).sum() / total:.2f}%",
              help="Weighted by balance")

    upcoming = debts.dropna(subset=["due_day"]).assign(due=lambda d: d["due_day"].map(next_due)).sort_values("due")
    if not upcoming.empty:
        st.subheader("Upcoming payments")
        for d in upcoming.itertuples():
            days = (d.due - dt.date.today()).days
            when = "today" if days == 0 else f"in {days} day{'s' if days != 1 else ''}"
            st.write(f"{'⚠️ ' if days <= 3 else ''}**{d.name}**: {md_money(d.min_payment)} due "
                     f"{d.due:%a %d %b} ({when})")

    st.subheader("Payoff planner")
    extra = st.number_input("Extra I can pay each month on top of the minimums", min_value=0.0, value=100.0,
                            step=25.0, format="%.2f")
    records = debts.to_dict("records")
    results = {s: simulate_payoff(records, extra, s) for s in ("avalanche", "snowball")}
    baseline = simulate_payoff(records, 0, "avalanche")

    def finish(months):
        return "never (minimums don't cover interest)" if months is None else \
            f"{shift_month(dt.date.today(), months):%b %Y} ({months} months)"

    c1, c2, c3 = st.columns(3)
    for col, (title, res) in zip((c1, c2, c3), (
            ("Avalanche: highest interest first", results["avalanche"]),
            ("Snowball: smallest balance first", results["snowball"]),
            ("Minimums only", baseline))):
        col.markdown(f"**{title}**")
        col.write(f"Debt-free: {finish(res['months'])}")
        col.write(f"Interest paid: {md_money(res['total_interest'])}")

    best = min(results, key=lambda s: (results[s]["months"] or 10 ** 9, results[s]["total_interest"]))
    if baseline["months"] and results[best]["months"]:
        st.success(f"Paying {md_money(extra)} extra with **{best}** saves "
                   f"{md_money(baseline['total_interest'] - results[best]['total_interest'])} in interest and gets you "
                   f"debt-free {baseline['months'] - results[best]['months']} months sooner.")

    chart = pd.concat([
        results["avalanche"]["history"].assign(plan="Avalanche"),
        results["snowball"]["history"].assign(plan="Snowball"),
        baseline["history"].assign(plan="Minimums only"),
    ])
    fig = px.line(chart, x="month", y="balance", color="plan", labels={"month": "Months from now", "balance": ""},
                  color_discrete_map={"Avalanche": TEAL, "Snowball": "#7570b3", "Minimums only": "#999999"})
    fig.update_layout(height=320, margin=dict(l=0, r=0, t=10, b=0), legend_title_text="")
    st.plotly_chart(fig, width="stretch")
    st.write(f"**Payoff order ({best}):** " + " → ".join(
        f"{name} ({shift_month(dt.date.today(), m):%b %Y})" for name, m in results[best]["order"]))


def page_recurring():
    st.title("Recurring charges")
    st.caption("Detected automatically from the last 13 months: same merchant, similar amount, regular timing.")
    tx = db.transactions(start=shift_month(dt.date.today(), -12))
    recurring = detect_recurring(tx[tx["kind"] != "transfer"])
    if recurring.empty:
        st.info("Nothing recurring found yet. Each charge needs to appear at least 3 times.")
        return
    st.metric("Recurring costs per month", money(recurring["monthly_cost"].sum()),
              f"{money(recurring['monthly_cost'].sum() * 12)} per year", delta_color="off")
    st.dataframe(
        recurring, hide_index=True, width="stretch",
        column_config={
            "merchant": "Merchant",
            "frequency": "How often",
            "avg_amount": st.column_config.NumberColumn("Typical charge", format="%.2f"),
            "monthly_cost": st.column_config.NumberColumn("Per month", format="%.2f"),
            "times_seen": "Times seen",
            "last_charge": st.column_config.DateColumn("Last charge"),
            "next_expected": st.column_config.DateColumn("Next expected"),
        },
    )


def page_settings():
    st.title("Settings")
    currency = st.text_input("Currency symbol", CUR, max_chars=5)
    if st.button("Save") and currency != CUR:
        db.set_setting("currency", currency)
        st.rerun()

    st.subheader("Backup & export")
    all_tx = db.transactions()
    st.download_button("Download all transactions (CSV)",
                       all_tx.drop(columns=["category_id", "account_id"]).to_csv(index=False),
                       file_name=f"transactions-{dt.date.today()}.csv", mime="text/csv")
    if db.DB_PATH.exists():
        st.download_button("Download full database backup", db.DB_PATH.read_bytes(),
                           file_name=f"finance-backup-{dt.date.today()}.db")

    st.subheader("Demo data")
    st.caption("Adds two demo accounts with six months of made-up transactions, sample rules, budgets and debts.")
    if st.button("Load demo data"):
        import demo
        demo.load_demo()
        st.success("Demo data loaded. Open the Dashboard.")
    demo_accounts = db.accounts().query("name.str.startswith('Demo ')", engine="python")
    if not demo_accounts.empty and st.button("Remove demo accounts"):
        for account_id in demo_accounts["id"]:
            db.delete_account(account_id)
        st.rerun()


PAGES = {
    "📊 Dashboard": page_dashboard,
    "💳 Transactions": page_transactions,
    "📥 Import CSV": page_import,
    "🏦 Accounts": page_accounts,
    "🏷️ Categories & Budgets": page_categories,
    "📉 Debts": page_debts,
    "🔁 Recurring": page_recurring,
    "⚙️ Settings": page_settings,
}
choice = st.sidebar.radio("Go to", list(PAGES), label_visibility="collapsed")
PAGES[choice]()
