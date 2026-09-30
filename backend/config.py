"""Loads secrets from .env (never committed) and creates an encryption key on first run."""
import os
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"

load_dotenv(ENV_PATH)

if not os.environ.get("ENCRYPTION_KEY"):
    key = Fernet.generate_key().decode()
    with ENV_PATH.open("a", encoding="utf-8") as f:
        f.write(f"\n# Encrypts bank access tokens stored in the database. Don't lose or share it.\nENCRYPTION_KEY={key}\n")
    os.environ["ENCRYPTION_KEY"] = key

PLAID_CLIENT_ID = os.environ.get("PLAID_CLIENT_ID", "").strip()
PLAID_SECRET = os.environ.get("PLAID_SECRET", "").strip()
PLAID_ENV = os.environ.get("PLAID_ENV", "sandbox").strip().lower()

_fernet = Fernet(os.environ["ENCRYPTION_KEY"].encode())


def encrypt(text):
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token):
    return _fernet.decrypt(token.encode()).decode()


def plaid_configured():
    return bool(PLAID_CLIENT_ID and PLAID_SECRET)


def save_plaid_keys(client_id, secret, env):
    """Write Plaid keys into .env (replacing old values) and use them immediately."""
    global PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV
    values = {"PLAID_CLIENT_ID": client_id.strip(), "PLAID_SECRET": secret.strip(), "PLAID_ENV": env.strip().lower()}
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    lines = [line for line in lines if line.split("=", 1)[0].strip() not in values]
    lines += [f"{key}={value}" for key, value in values.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ.update(values)
    PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV = values["PLAID_CLIENT_ID"], values["PLAID_SECRET"], values["PLAID_ENV"]
