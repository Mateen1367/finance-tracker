"""Six months of realistic fake data, so every screen has something to show before a bank is connected."""
import datetime as dt
import random

from . import db

# merchant, description, category, account, (low, high) amount, days of month (or count per month)
MONTHLY = [
    ("Acme Corp", "ACME CORP PAYROLL", "Income", "checking", (2250, 2250), [1, 15]),
    ("Oak Apartments", "OAK APARTMENTS RENT", "Housing", "checking", (1400, 1400), [2]),
    ("Metro Auto Finance", "METRO AUTO LOAN PMT", "Debt Payments", "checking", (250, 250), [15]),
    ("City Electric", "CITY ELECTRIC CO", "Bills & Utilities", "checking", (60, 115), [18]),
    ("Fastnet", "FASTNET INTERNET", "Bills & Utilities", "checking", (65, 65), [20]),
    ("Verizon", "VERIZON WIRELESS", "Bills & Utilities", "card", (85, 85), [9]),
    ("Netflix", "NETFLIX.COM", "Subscriptions", "card", (15.49, 15.49), [5]),
    ("Spotify", "SPOTIFY USA", "Subscriptions", "card", (11.99, 11.99), [12]),
    ("iCloud", "APPLE.COM/BILL", "Subscriptions", "card", (2.99, 2.99), [21]),
    ("Planet Fitness", "PLANET FITNESS", "Health", "card", (24.99, 24.99), [3]),
]
RANDOM = [
    ("Trader Joe's", "TRADER JOE'S #512", "Groceries", (35, 95), 4),
    ("Costco", "COSTCO WHOLESALE", "Groceries", (80, 190), 1),
    ("Starbucks", "STARBUCKS STORE 1182", "Dining", (4.5, 9), 7),
    ("Chipotle", "CHIPOTLE 2214", "Dining", (11, 18), 3),
    ("DoorDash", "DOORDASH*DASHPASS", "Dining", (18, 42), 2),
    ("Uber", "UBER *TRIP", "Transport", (9, 28), 4),
    ("Shell", "SHELL OIL 5741", "Transport", (35, 58), 2),
    ("Amazon", "AMAZON MKTPL", "Shopping", (12, 85), 3),
    ("Target", "TARGET 00021", "Shopping", (20, 110), 1),
    ("AMC Theatres", "AMC THEATRES", "Entertainment", (14, 32), 1),
    ("CVS", "CVS/PHARMACY", "Health", (8, 35), 1),
]


def load_demo():
    if db.row("SELECT 1 FROM accounts WHERE is_demo = 1"):
        return
    rng = random.Random(11)
    today = dt.date.today()
    categories = {r["name"]: r["id"] for r in db.rows("SELECT id, name FROM categories")}

    with db.connect() as con:
        def account(name, type_, institution, mask, opening):
            return con.execute(
                "INSERT INTO accounts(name, type, institution, mask, opening_balance, is_demo) VALUES (?, ?, ?, ?, ?, 1)",
                (name, type_, institution, mask, opening)).lastrowid

        ids = {
            "checking": account("Everyday Checking", "Checking", "Demo Bank", "4821", 3100),
            "savings": account("High-Yield Savings", "Savings", "Demo Bank", "9930", 8200),
            "card": account("Rewards Card", "Credit Card", "Demo Card Co", "1007", -420),
        }

        def add(day, merchant, description, category, account_key, amount):
            if day > today:
                return
            age = (today - day).days
            con.execute(
                """INSERT INTO transactions(account_id, date, description, merchant, amount, category_id,
                                            pending, reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (ids[account_key], day.isoformat(), description, merchant, round(amount, 2),
                 categories.get(category), int(age <= 1), int(age > 6)))

        for back in range(5, -1, -1):
            y, m = divmod(today.year * 12 + today.month - 1 - back, 12)
            first = dt.date(y, m + 1, 1)
            for merchant, desc, category, acct, (lo, hi), days in MONTHLY:
                for d in days:
                    amount = rng.uniform(lo, hi)
                    add(first.replace(day=d), merchant, desc, category, acct, amount if category == "Income" else -amount)
            for merchant, desc, category, (lo, hi), count in RANDOM:
                for _ in range(count):
                    add(first.replace(day=rng.randint(1, 28)), merchant, desc, category, "card", -rng.uniform(lo, hi))
            add(first.replace(day=25), "Rewards Card", "CARD PAYMENT - THANK YOU", "Transfer", "checking", -1200)
            add(first.replace(day=25), "Everyday Checking", "PAYMENT RECEIVED", "Transfer", "card", 1200)
            add(first.replace(day=3), "High-Yield Savings", "TRANSFER TO SAVINGS", "Transfer", "checking", -300)
            add(first.replace(day=3), "Everyday Checking", "TRANSFER FROM CHECKING", "Transfer", "savings", 300)
            add(first.replace(day=28), "Interest", "INTEREST PAYMENT", "Income", "savings", rng.uniform(28, 34))

        budgets = {"Groceries": 450, "Dining": 250, "Transport": 200, "Shopping": 200,
                   "Subscriptions": 40, "Entertainment": 60}
        for name, amount in budgets.items():
            con.execute("UPDATE categories SET budget = ? WHERE name = ? AND budget = 0", (amount, name))

        con.executemany(
            "INSERT INTO debts(name, lender, balance, apr, min_payment, due_day, is_demo) VALUES (?, ?, ?, ?, ?, ?, 1)",
            [("Car Loan", "Metro Auto Finance", 8500, 6.9, 250, 15),
             ("Student Loan", "Nelnet", 14200, 4.99, 160, 1),
             ("Personal Loan", "SoFi", 3200, 11.5, 110, 22)])


def remove_demo():
    with db.connect() as con:
        con.execute("DELETE FROM accounts WHERE is_demo = 1")
        con.execute("DELETE FROM debts WHERE is_demo = 1")
