"""Generates six months of fake data so every page has something to show."""
import datetime as dt
import random

import pandas as pd

import db

DEMO_RULES = {
    "SALARY": "Income", "RENT": "Housing", "NETFLIX": "Subscriptions", "SPOTIFY": "Subscriptions",
    "ELECTRIC": "Bills & Utilities", "INTERNET": "Bills & Utilities", "GROCER": "Groceries",
    "CAFE": "Dining", "UBER": "Transport", "AMAZON": "Shopping", "CARD PAYMENT": "Transfer",
    "GYM": "Health", "CAR LOAN": "Debt Payments",
}
DEMO_BUDGETS = {"Groceries": 400, "Dining": 120, "Transport": 120, "Shopping": 150, "Subscriptions": 30}


def load_demo():
    rng = random.Random(7)
    today = dt.date.today()
    checking, card = [], []

    def add(rows, day, desc, amount):
        if day <= today:
            rows.append({"date": day.isoformat(), "description": desc, "amount": round(amount, 2)})

    for back in range(5, -1, -1):
        y, m = divmod(today.year * 12 + today.month - 1 - back, 12)
        first = dt.date(y, m + 1, 1)
        on = lambda d: first.replace(day=d)
        add(checking, on(1), "ACME CORP SALARY", 4500)
        add(checking, on(2), "RENT PAYMENT - OAK APARTMENTS", -1400)
        add(checking, on(15), "CAR LOAN AUTOPAY", -250)
        add(checking, on(18), f"CITY ELECTRIC {rng.randint(1000, 9999)}", -rng.uniform(60, 110))
        add(checking, on(20), "FASTNET INTERNET", -45)
        add(card, on(5), f"NETFLIX.COM {rng.randint(1000, 9999)}", -15.49)
        add(card, on(12), "SPOTIFY PREMIUM", -10.99)
        add(card, on(3), "IRONWORKS GYM", -35)
        for week in range(4):
            add(card, on(4 + week * 7), "FRESHMART GROCERY", -rng.uniform(55, 120))
        for _ in range(6):
            add(card, on(rng.randint(1, 28)), "CORNER CAFE", -rng.uniform(4, 16))
        for _ in range(5):
            add(card, on(rng.randint(1, 28)), "UBER TRIP", -rng.uniform(8, 25))
        for _ in range(2):
            add(card, on(rng.randint(1, 28)), "AMAZON MARKETPLACE", -rng.uniform(15, 90))
        add(checking, on(25), "CARD PAYMENT - THANK YOU", -600)
        add(card, on(25), "CARD PAYMENT - THANK YOU", 600)

    cats = db.categories().set_index("name")["id"]
    existing_rules = set(db.rules()["pattern"].str.upper())
    for pattern, category in DEMO_RULES.items():
        if pattern not in existing_rules:
            db.add_rule(pattern, cats[category])
    for category, budget in DEMO_BUDGETS.items():
        db.execute("UPDATE categories SET budget = ? WHERE id = ? AND budget = 0", (budget, int(cats[category])))

    names = set(db.accounts()["name"])
    if "Demo Checking" not in names:
        db.import_transactions(db.add_account("Demo Checking", "Checking", 2500), pd.DataFrame(checking))
    if "Demo Credit Card" not in names:
        db.import_transactions(db.add_account("Demo Credit Card", "Credit Card", -350), pd.DataFrame(card))
    if db.debts().empty:
        db.save_debts(pd.DataFrame([
            {"name": "Car Loan", "lender": "Metro Bank", "balance": 8500, "apr": 6.9, "min_payment": 250, "due_day": 15},
            {"name": "Student Loan", "lender": "EduFund", "balance": 12000, "apr": 4.5, "min_payment": 150, "due_day": 1},
            {"name": "Personal Loan", "lender": "QuickCash", "balance": 2200, "apr": 18.0, "min_payment": 90, "due_day": 22},
        ]))
