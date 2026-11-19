#!/usr/bin/env python3
"""Import employee bindings from an offline copy of the legacy iOS pool."""
import argparse
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit


def migrate(root, database):
    origin = (root / "origin").read_text().strip().lower()
    parsed = urlsplit(origin)
    if not parsed.hostname or parsed.username is not None or origin != "https://" + parsed.netloc:
        raise ValueError("Invalid HTTPS origin in the source directory")

    records = []
    for status in ("assigned", "revoked"):
        for path in (root / status).iterdir():
            if not re.fullmatch(r"[a-f0-9]{64}", path.name):
                continue
            item = json.loads(path.read_text())
            owner = item.get("owner")
            if ((owner is not None or status == "assigned")
                    and not re.fullmatch(r"[a-f0-9]{64}", owner or "")):
                raise ValueError(f"Invalid employee binding at record {item['id']}")
            records.append((item["id"], origin, path.name, status, owner,
                            item.get("employee", ""), item.get("assigned_at", 0)))

    db = sqlite3.connect(database.resolve().as_uri() + "?mode=rw", uri=True)
    try:
        with db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM ios_subscriptions LIMIT 1").fetchone():
                raise ValueError("The destination iOS pool already contains records")
            db.executemany("""INSERT INTO ios_subscriptions
                (id,origin,token,status,owner_hash,employee,assigned_at)
                VALUES(?,?,?,?,?,?,?)""", records)
    finally:
        db.close()
    return len(records)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pool", type=Path)
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    print(f"Imported {migrate(args.pool, args.database)} historical records")
