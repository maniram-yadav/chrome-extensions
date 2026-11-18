#!/usr/bin/env python3
"""
Tag US phone numbers in a CSV with line type (Mobile / Landline / VoIP / Toll-free / Other)
and SMS capability, using Twilio Lookup v2 (Line Type Intelligence).

Usage:
    python tag_phones.py "restaurants_in_Austin_2026-11-18.csv"
    python tag_phones.py input.csv -o output.csv
    python tag_phones.py input.csv --in-place
    python tag_phones.py input.csv --dry-run          # no API calls, shows how many lookups it would make

Credentials (environment variables, or a .env file next to this script / in the current folder):
    TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    TWILIO_AUTH_TOKEN=your_auth_token

Only the Python standard library is used - no pip install needed.
"""

import argparse
import base64
import csv
import json
import os
import re
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

LOOKUP_URL = "https://lookups.twilio.com/v2/PhoneNumbers/{}?Fields=line_type_intelligence"
COST_PER_LOOKUP = 0.008  # USD, approximate - check current Twilio pricing

TOLL_FREE_AREA_CODES = {"800", "833", "844", "855", "866", "877", "888"}

NEW_COLUMNS = ["Phone (E.164)", "Phone Type", "SMS Capable", "Carrier", "Lookup Status"]

# Twilio line type -> (Phone Type, SMS Capable)
TYPE_MAP = {
    "mobile": ("Mobile", "Yes"),
    "nonFixedVoip": ("VoIP", "Likely"),
    "fixedVoip": ("VoIP", "Maybe"),
    "landline": ("Landline", "No"),
    "tollFree": ("Toll-free", "Only if text-enabled"),
    "premium": ("Other", "No"),
    "sharedCost": ("Other", "No"),
    "uan": ("Other", "No"),
    "voicemail": ("Other", "No"),
    "pager": ("Other", "No"),
    "personal": ("Other", "Unknown"),
    "unknown": ("Other", "Unknown"),
}


class AuthError(Exception):
    pass


# ---------------------------------------------------------------- credentials

def load_dotenv():
    for folder in (Path.cwd(), Path(__file__).resolve().parent):
        env = folder / ".env"
        if not env.is_file():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


# ---------------------------------------------------------------- phone parsing

def to_e164_us(raw):
    """Return (e164, problem). problem is None when the number looks like a valid US/NANP number."""
    if not raw or not raw.strip():
        return "", "No phone"
    text = raw.strip()
    # Drop extensions like "x123" / "ext. 123"
    text = re.split(r"(?i)\s*(?:ext\.?|x|#)\s*\d+\s*$", text)[0]
    digits = re.sub(r"\D", "", text)
    if text.startswith("+") and not digits.startswith("1"):
        return "+" + digits, "Not a US number"
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return "", "Invalid number"
    if digits[0] in "01" or digits[3] in "01":
        return "+1" + digits, "Invalid number"
    return "+1" + digits, None


# ---------------------------------------------------------------- Twilio

class TwilioLookup:
    def __init__(self, sid, token, timeout=20, max_retries=4):
        self.auth = "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode()
        self.timeout = timeout
        self.max_retries = max_retries

    def lookup(self, e164):
        url = LOOKUP_URL.format(urllib.parse.quote(e164))
        req = urllib.request.Request(url, headers={"Authorization": self.auth, "Accept": "application/json"})
        delay = 1.0
        for attempt in range(self.max_retries + 1):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", "replace")
                if e.code in (401, 403):
                    raise AuthError(f"Twilio rejected the credentials (HTTP {e.code}): {body}")
                if e.code == 404:
                    return {"valid": False}
                if e.code == 429 or e.code >= 500:
                    if attempt < self.max_retries:
                        retry_after = e.headers.get("Retry-After")
                        time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else delay)
                        delay *= 2
                        continue
                raise RuntimeError(f"HTTP {e.code}: {body[:200]}")
            except (urllib.error.URLError, TimeoutError) as e:
                if attempt < self.max_retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
                raise RuntimeError(f"Network error: {e}")
        raise RuntimeError("Retries exhausted")


def classify(data):
    """Turn a Twilio response into a result dict for the cache/CSV."""
    if not data.get("valid", True):
        return {"type": "Invalid", "sms": "No", "carrier": "", "status": "Invalid number (Twilio)"}
    lti = data.get("line_type_intelligence") or {}
    if lti.get("error_code"):
        return {"type": "Unknown", "sms": "Unknown", "carrier": "", "status": f"Twilio error {lti['error_code']}"}
    raw_type = lti.get("type") or "unknown"
    phone_type, sms = TYPE_MAP.get(raw_type, ("Other", "Unknown"))
    return {"type": phone_type, "sms": sms, "carrier": lti.get("carrier_name") or "", "status": f"OK ({raw_type})"}


# ---------------------------------------------------------------- cache

class Cache:
    """JSON cache so the same number is never paid for twice (across runs and files)."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.data = {}
        if self.path.is_file():
            try:
                self.data = json.loads(self.path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                print(f"Warning: cache file {self.path} is corrupt, starting a new one.", file=sys.stderr)

    def get(self, key):
        return self.data.get(key)

    def put(self, key, value):
        with self.lock:
            self.data[key] = value

    def save(self):
        with self.lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=1), encoding="utf-8")
            os.replace(tmp, self.path)


# ---------------------------------------------------------------- CSV

def find_phone_column(headers, wanted):
    if wanted:
        if wanted not in headers:
            sys.exit(f"Column '{wanted}' not found. Columns: {', '.join(headers)}")
        return wanted
    for h in headers:
        if h.strip().lower() in ("phone", "phone number", "phone_number", "telephone", "tel"):
            return h
    for h in headers:
        if "phone" in h.lower() and h not in NEW_COLUMNS:
            return h
    sys.exit(f"Could not find a phone column. Use --column. Columns: {', '.join(headers)}")


def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def write_csv(path, headers, rows):
    # Write to a temp file then replace, so an interrupted run never leaves a half-written CSV.
    folder = Path(path).resolve().parent
    fd, tmp = tempfile.mkstemp(suffix=".csv", dir=folder)
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8-sig") as f:  # BOM for Excel
            writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def output_headers(headers, phone_col):
    base = [h for h in headers if h not in NEW_COLUMNS]
    idx = base.index(phone_col) + 1
    return base[:idx] + NEW_COLUMNS + base[idx:]


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Tag US phone numbers in a CSV via Twilio Lookup (line type + SMS capability).")
    ap.add_argument("input", help="CSV file exported by the Google Maps scraper")
    ap.add_argument("-o", "--output", help="Output CSV (default: <input>_tagged.csv)")
    ap.add_argument("--in-place", action="store_true", help="Overwrite the input file")
    ap.add_argument("--column", help="Name of the phone column (auto-detected by default)")
    ap.add_argument("--workers", type=int, default=5, help="Parallel lookups (default 5)")
    ap.add_argument("--cache", default=str(Path(__file__).resolve().parent / "phone_lookup_cache.json"),
                    help="Lookup cache file (default: phone_lookup_cache.json next to this script)")
    ap.add_argument("--dry-run", action="store_true", help="Don't call Twilio; show how many lookups are needed")
    ap.add_argument("-y", "--yes", action="store_true", help="Don't ask for confirmation before paid lookups")
    args = ap.parse_args()

    in_path = Path(args.input)
    if not in_path.is_file():
        sys.exit(f"File not found: {in_path}")
    out_path = in_path if args.in_place else Path(args.output or in_path.with_name(in_path.stem + "_tagged.csv"))

    headers, rows = read_csv(in_path)
    phone_col = find_phone_column(headers, args.column)
    cache = Cache(args.cache)

    # Offline pass: normalise, catch invalid / non-US / toll-free numbers without paying for them.
    offline, to_lookup = {}, set()
    for row in rows:
        e164, problem = to_e164_us(row.get(phone_col, ""))
        row["Phone (E.164)"] = e164 if not problem or problem == "Not a US number" else ""
        if problem:
            phone_type, sms = {"No phone": ("", ""), "Invalid number": ("Invalid", "No")}.get(problem, ("Other", "Unknown"))
            offline[id(row)] = {"type": phone_type, "sms": sms, "carrier": "", "status": problem}
        elif e164[2:5] in TOLL_FREE_AREA_CODES:
            offline[id(row)] = {"type": "Toll-free", "sms": "Only if text-enabled", "carrier": "", "status": "Toll-free (offline)"}
        elif not cache.get(e164):
            to_lookup.add(e164)

    with_phone = sum(1 for r in rows if r["Phone (E.164)"])
    print(f"Rows: {len(rows)} | with valid phone: {with_phone} | unique numbers needing lookup: {len(to_lookup)} "
          f"(already cached: {len({r['Phone (E.164)'] for r in rows if r['Phone (E.164)'] and cache.get(r['Phone (E.164)'])})})")
    print(f"Estimated Twilio cost: ${len(to_lookup) * COST_PER_LOOKUP:.2f}")

    if args.dry_run:
        return

    if to_lookup:
        load_dotenv()
        sid, token = os.environ.get("TWILIO_ACCOUNT_SID"), os.environ.get("TWILIO_AUTH_TOKEN")
        if not sid or not token:
            sys.exit("Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (environment variables or a .env file).")
        if not args.yes and sys.stdin.isatty():
            if input(f"Run {len(to_lookup)} paid lookups? [y/N] ").strip().lower() != "y":
                sys.exit("Cancelled.")

        client = TwilioLookup(sid, token)
        done, failed = 0, 0
        try:
            with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
                futures = {pool.submit(client.lookup, n): n for n in sorted(to_lookup)}
                for fut in as_completed(futures):
                    number = futures[fut]
                    try:
                        cache.put(number, classify(fut.result()))
                    except AuthError as e:
                        for f in futures:
                            f.cancel()
                        raise
                    except Exception as e:  # keep going; failed numbers are retried next run
                        failed += 1
                        print(f"  {number}: lookup failed - {e}", file=sys.stderr)
                    done += 1
                    if done % 25 == 0 or done == len(futures):
                        print(f"  {done}/{len(futures)} looked up")
                        cache.save()
        except AuthError as e:
            cache.save()
            sys.exit(str(e))
        except KeyboardInterrupt:
            cache.save()
            sys.exit("\nInterrupted - results so far are cached; re-run to continue.")
        cache.save()
        if failed:
            print(f"{failed} lookups failed (marked 'Lookup failed'); re-run to retry only those.")

    # Fill the new columns.
    counts = {}
    for row in rows:
        res = offline.get(id(row)) or cache.get(row["Phone (E.164)"]) or \
            {"type": "Unknown", "sms": "Unknown", "carrier": "", "status": "Lookup failed"}
        row["Phone Type"], row["SMS Capable"] = res["type"], res["sms"]
        row["Carrier"], row["Lookup Status"] = res["carrier"], res["status"]
        if res["type"]:
            counts[res["type"]] = counts.get(res["type"], 0) + 1

    write_csv(out_path, output_headers(headers, phone_col), rows)
    print("Summary: " + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    print(f"Saved: {out_path}")


if __name__ == "__main__":
    main()
