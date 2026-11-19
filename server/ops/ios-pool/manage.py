#!/usr/bin/python3
"""Restricted SSH command for the employee subscription pool on the node."""
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import time

ROOT = Path("/var/lib/vergen-ios-pool")
STATES = ("available", "assigned", "revoked")
MAX_IMPORT_BYTES = 256 * 1024
MAX_IMPORT_ROWS = 1000


def save(path, record):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".", delete=False) as file:
        try:
            json.dump(record, file, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())
            os.replace(file.name, path)
        finally:
            Path(file.name).unlink(missing_ok=True)


def subscription(root, path):
    origin = (root / "origin").read_text().strip()
    return {"url": origin + "/sub/" + path.name + "/clash.yaml"}


def import_addresses(root, records, text):
    if not isinstance(text, str) or len(text.encode()) > MAX_IMPORT_BYTES:
        return {"error": "import_size"}
    origin = (root / "origin").read_text().strip()
    pattern = re.compile(re.escape(origin) + r"/sub/([0-9a-f]{64})/clash\.yaml")
    existing = {path.name for _, path, _ in records}
    new_keys = []
    rows = 0
    for number, line in enumerate(text.removeprefix("\ufeff").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        rows += 1
        if rows > MAX_IMPORT_ROWS:
            return {"error": "import_size"}
        match = pattern.fullmatch(line)
        if not match:
            return {"error": "invalid_address", "line": number}
        key = match[1]
        if key not in existing:
            new_keys.append(key)
            existing.add(key)
    if not rows:
        return {"error": "empty_import"}
    last = records[-1][2]["id"] if records else 0
    for number, key in enumerate(new_keys, start=last + 1):
        save(root / "available" / key, {"id": number})
    return {"added": len(new_keys), "skipped": rows - len(new_keys)}


def manage(root, request):
    with (root / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        records = []
        for state in STATES:
            for path in (root / state).iterdir():
                if re.fullmatch("[0-9a-f]{64}", path.name):
                    records.append((state, path, json.loads(path.read_text())))
        records.sort(key=lambda row: row[2]["id"])
        action = request["action"]
        if action == "import":
            return import_addresses(root, records, request.get("text"))
        if action == "fill":
            missing = 100 - sum(state == "available" for state, _, _ in records)
            last = records[-1][2]["id"] if records else 0
            for number in range(last + 1, last + 1 + missing):
                path = root / "available" / secrets.token_hex(32)
                save(path, {"id": number})
            return {"generated": max(0, missing)}
        if action == "list":
            origin = (root / "origin").read_text().strip()
            return {"items": [
                {"id": data["id"], "status": state, "employee": data.get("employee", ""),
                 "assigned_at": data.get("assigned_at", 0),
                 "address_preview": origin + "/sub/…" + path.name[-8:] + "/clash.yaml"}
                for state, path, data in records
            ]}
        if action == "claim":
            owner = request["owner"]
            if not re.fullmatch("[0-9a-f]{64}", owner):
                raise ValueError("invalid employee")
            for state, path, data in records:
                if state != "available" and data.get("owner") == owner:
                    return {"error": "revoked"} if state == "revoked" else subscription(root, path)
            for state, path, data in records:
                if state == "available":
                    save(path, {"id": data["id"], "owner": owner,
                                "employee": request["employee"][:256], "assigned_at": int(time.time())})
                    path.rename(root / "assigned" / path.name)
                    return subscription(root, path)
            return {"error": "empty"}
        if action in ("address", "revoke"):
            for state, path, data in records:
                if data["id"] == request["id"]:
                    if action == "address":
                        return subscription(root, path)
                    if state != "revoked":
                        path.rename(root / "revoked" / path.name)
                    return {}
            return {"error": "missing"}
        raise ValueError("unknown action")


if __name__ == "__main__":
    os.umask(0o077)
    data = sys.stdin.buffer.readline((1 << 20) + 1)
    if len(data) > 1 << 20:
        sys.exit(1)
    print(json.dumps(manage(ROOT, json.loads(data)), ensure_ascii=False))
