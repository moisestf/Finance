#!/usr/bin/env python3
"""
Add or update a user in data/auth.json for the Stock Ledger login screen.

The password is only ever held in memory for the duration of this script
(read via getpass, which doesn't echo it to the terminal or save it to shell
history) and is never written to disk anywhere. Only a salted PBKDF2-SHA256
hash is stored, which cannot be reversed back into the original password
even if auth.json leaks.

Adding a user does NOT require or reveal any other user's password — each
user has their own independent salt+hash, and this script only ever touches
the entry for the username you pass in.

Usage:
    python scripts/generate_credentials.py --username mrodriba
    python scripts/generate_credentials.py --username visitante
    python scripts/generate_credentials.py --username visitante --remove
"""
import argparse
import getpass
import hashlib
import json
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUTH_FILE = ROOT / "data" / "auth.json"

ITERATIONS = 210_000  # OWASP-recommended minimum for PBKDF2-HMAC-SHA256 (2023+)
HASH_LEN_BYTES = 32


def load_auth():
    if AUTH_FILE.exists():
        with open(AUTH_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        # Migrate the old single-user format if it's still around.
        if "users" not in data and "username" in data:
            data = {
                "algorithm": data.get("algorithm", "PBKDF2-SHA256"),
                "iterations": data.get("iterations", ITERATIONS),
                "users": [{"username": data["username"], "salt": data["salt"], "hash": data["hash"]}],
            }
        return data
    return {"algorithm": "PBKDF2-SHA256", "iterations": ITERATIONS, "users": []}


def save_auth(data):
    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--username", required=True, help="Login username to add/update/remove")
    parser.add_argument("--remove", action="store_true", help="Remove this user instead of adding/updating it")
    args = parser.parse_args()

    data = load_auth()
    data["users"] = [u for u in data["users"] if u["username"] != args.username]

    if args.remove:
        save_auth(data)
        print(f"Usuario '{args.username}' eliminado de {AUTH_FILE}.")
        return

    password = getpass.getpass(f"Contraseña para '{args.username}': ")
    confirm = getpass.getpass("Confírmala: ")
    if password != confirm:
        raise SystemExit("Las contraseñas no coinciden.")
    if len(password) < 6:
        raise SystemExit("Usa al menos 6 caracteres.")

    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, data["iterations"], dklen=HASH_LEN_BYTES)

    data["users"].append({"username": args.username, "salt": salt.hex(), "hash": derived.hex()})
    save_auth(data)

    print(f"\n{AUTH_FILE} actualizado para el usuario '{args.username}'.")
    print("La contraseña en sí no quedó guardada en ningún lado, solo su hash.")
    print(f"Usuarios actuales: {[u['username'] for u in data['users']]}")


if __name__ == "__main__":
    main()
