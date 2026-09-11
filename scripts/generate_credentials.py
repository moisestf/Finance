#!/usr/bin/env python3
"""
Generate data/auth.json for the Stock Ledger login screen.

The password is only ever held in memory for the duration of this script
(read via getpass, which doesn't echo it to the terminal) and is never
written to disk anywhere. Only a salted PBKDF2-SHA256 hash is stored, which
cannot be reversed back into the original password even if auth.json leaks.

Usage:
    python scripts/generate_credentials.py --username mrodriba
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", required=True, help="Login username")
    args = parser.parse_args()

    password = getpass.getpass("Nueva contraseña: ")
    confirm = getpass.getpass("Confírmala: ")
    if password != confirm:
        raise SystemExit("Las contraseñas no coinciden.")
    if len(password) < 6:
        raise SystemExit("Usa al menos 6 caracteres.")

    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS, dklen=HASH_LEN_BYTES)

    data = {
        "username": args.username,
        "algorithm": "PBKDF2-SHA256",
        "iterations": ITERATIONS,
        "salt": salt.hex(),
        "hash": derived.hex(),
    }

    AUTH_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(AUTH_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")

    print(f"\n{AUTH_FILE} actualizado para el usuario '{args.username}'.")
    print("La contraseña en sí no quedó guardada en ningún lado, solo su hash.")


if __name__ == "__main__":
    main()
