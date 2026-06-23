#!/usr/bin/env python3
"""
compile-artist-context.py

Reads markdown entries from the Tour Wiki vault and compiles them into
js/artist-context.json for the NTLB app.

Usage:
    python3 dev/compile-artist-context.py

The script:
  - Reads all .md files under Artists/ in the Tour Wiki vault
  - Parses frontmatter (band, era), the "From the Artist" blurb, and quotes
  - Expands year ranges ("1993-1994" → entries for 1993 and 1994)
  - Merges into js/artist-context.json (preserving any existing entries
    not present in the vault)
  - Artist name in the JSON must match the IA `creator` field exactly.
    Use NAME_OVERRIDES below to handle mismatches.
"""

import json
import os
import re
import sys

# ── Paths ────────────────────────────────────────────────────────────────────

VAULT_DIR = os.path.expanduser("~/Projects/Sites/Tour Wiki/Artists")
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "..", "js", "artist-context.json")

# ── IA creator name overrides ─────────────────────────────────────────────────
# Map vault `band:` value → IA creator field value when they differ.
# Verified 2026-06-22 against actual IA metadata. IA preserves accents and
# umlauts (Sinéad O'Connor, Hüsker Dü confirmed). Add entries only where
# the vault name genuinely differs from the IA creator field.

NAME_OVERRIDES = {
    # "Vault Name": "IA Creator Name",
    # (none confirmed necessary as of 2026-06-22 — IA matches vault names)
}

# ── IA creator name aliases ───────────────────────────────────────────────────
# Some artists have MULTIPLE creator strings in the IA collection for different
# recordings. Map the primary vault name → list of additional IA creator strings
# that should receive the same content.
# Verified 2026-06-22:
#   Nick Cave 1985 recordings use "Nick Cave & The Bad Seeds" (ampersand)
#   Nick Cave 1986+ recordings use "Nick Cave and The Bad Seeds" (spelled out)

NAME_ALIASES = {
    "Nick Cave and The Bad Seeds": ["Nick Cave & The Bad Seeds"],
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_frontmatter(text):
    """Return (frontmatter_dict, body_text) from a markdown file."""
    fm = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            fm_block = text[3:end].strip()
            body = text[end + 4:].strip()
            for line in fm_block.splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    fm[k.strip()] = v.strip()
    return fm, body


def expand_years(era_str):
    """
    Turn an era string into a list of year strings.
    "1993"       → ["1993"]
    "1993-1994"  → ["1993", "1994"]
    "1993-1997"  → ["1993", "1994", "1995", "1996", "1997"]
    """
    era_str = era_str.strip()
    m = re.match(r"^(\d{4})-(\d{4})$", era_str)
    if m:
        start, end = int(m.group(1)), int(m.group(2))
        return [str(y) for y in range(start, end + 1)]
    m = re.match(r"^(\d{4})$", era_str)
    if m:
        return [m.group(1)]
    # Can't parse — skip
    return []


def extract_blurb_and_quotes(body):
    """
    Extract the From the Artist blurb (plain text paragraph) and quotes
    (blockquotes) from the markdown body.

    Returns (blurb_str, quotes_list) where quotes_list is a list of
    {"text": str, "attr": str} dicts.
    """
    # Find the "From the Artist" section
    section_match = re.search(
        r"^##\s+From the Artist\s*\n(.*?)(?=^##\s|\Z)",
        body,
        re.MULTILINE | re.DOTALL,
    )
    if not section_match:
        return "", []

    section = section_match.group(1)

    # Split into blockquote lines and non-blockquote lines
    blurb_lines = []
    raw_quotes = []
    current_quote_lines = []

    for line in section.splitlines():
        if line.startswith(">"):
            current_quote_lines.append(line[1:].strip())
        else:
            if current_quote_lines:
                raw_quotes.append(current_quote_lines)
                current_quote_lines = []
            if line.strip() and not line.startswith("#"):
                blurb_lines.append(line.strip())

    if current_quote_lines:
        raw_quotes.append(current_quote_lines)

    blurb = " ".join(blurb_lines).strip()

    # Also look in a separate "## Quotes" section if present
    quotes_section_match = re.search(
        r"^##\s+Quotes\s*\n(.*?)(?=^##\s|\Z)",
        body,
        re.MULTILINE | re.DOTALL,
    )
    if quotes_section_match:
        qs = quotes_section_match.group(1)
        current_quote_lines = []
        for line in qs.splitlines():
            if line.startswith(">"):
                current_quote_lines.append(line[1:].strip())
            else:
                if current_quote_lines:
                    raw_quotes.append(current_quote_lines)
                    current_quote_lines = []
        if current_quote_lines:
            raw_quotes.append(current_quote_lines)

    quotes = []
    for qlines in raw_quotes:
        # A quote block looks like:
        #   line 1: "the actual quote text"    (may or may not have outer quotes)
        #   line 2: — Speaker, Source, Year, URL
        # Sometimes the attribution continues on subsequent lines.
        text_lines = []
        attr_lines = []
        for ql in qlines:
            if ql.startswith("—") or ql.startswith("-"):
                attr_lines.append(ql.lstrip("—- ").strip())
            else:
                text_lines.append(ql)

        text = " ".join(text_lines).strip().strip('"')
        attr = " ".join(attr_lines).strip()

        # Strip trailing URL from attr for display (keep attr human-readable)
        attr = re.sub(r",?\s*https?://\S+", "", attr).strip().rstrip(",").strip()

        if text:
            quotes.append({"text": text, "attr": attr})

    return blurb, quotes


def process_vault(vault_dir):
    """
    Walk the vault Artists/ directory and return a dict ready for
    merging into artist-context.json.

    Structure: { "IA Creator Name": { "year": { "blurb": ..., "quotes": [...] } } }
    """
    result = {}

    if not os.path.isdir(vault_dir):
        print(f"ERROR: Vault directory not found: {vault_dir}", file=sys.stderr)
        sys.exit(1)

    for artist_dir in sorted(os.listdir(vault_dir)):
        artist_path = os.path.join(vault_dir, artist_dir)
        if not os.path.isdir(artist_path):
            continue

        for fname in sorted(os.listdir(artist_path)):
            if not fname.endswith(".md"):
                continue

            fpath = os.path.join(artist_path, fname)
            with open(fpath, encoding="utf-8") as f:
                content = f.read()

            fm, body = parse_frontmatter(content)

            band = fm.get("band", "").strip()
            era = fm.get("era", "").strip()

            if not band or not era:
                print(f"  SKIP (missing band or era): {fname}")
                continue

            # Apply IA name override if present
            ia_name = NAME_OVERRIDES.get(band, band)

            years = expand_years(era)
            if not years:
                print(f"  SKIP (unparseable era '{era}'): {fname}")
                continue

            blurb, quotes = extract_blurb_and_quotes(body)

            if not blurb:
                print(f"  WARN (no blurb found): {fname}")

            entry = {"blurb": blurb, "quotes": quotes}

            # Write under primary IA name
            all_names = [ia_name] + NAME_ALIASES.get(ia_name, [])
            for name in all_names:
                if name not in result:
                    result[name] = {}
                for year in years:
                    result[name][year] = entry

            for year in years:
                alias_note = f" + aliases: {NAME_ALIASES[ia_name]}" if ia_name in NAME_ALIASES else ""
                print(f"  + {ia_name} / {year}  ({len(quotes)} quote(s)){alias_note}")

    return result


def main():
    print(f"Vault: {VAULT_DIR}")
    print(f"Output: {OUTPUT_FILE}\n")

    # Load existing artist-context.json
    existing = {}
    if os.path.exists(OUTPUT_FILE):
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            try:
                existing = json.load(f)
            except json.JSONDecodeError as e:
                print(f"WARNING: Could not parse existing JSON: {e}")

    # Process vault
    print("Processing vault entries...")
    new_entries = process_vault(VAULT_DIR)

    # Merge: vault entries override existing; existing entries not in vault are preserved
    merged = dict(existing)
    for artist, years in new_entries.items():
        if artist not in merged:
            merged[artist] = {}
        merged[artist].update(years)

    # Sort for stable output
    merged = {
        artist: dict(sorted(years.items()))
        for artist, years in sorted(merged.items())
    }

    # Write output
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
        f.write("\n")

    total_artists = len(merged)
    total_entries = sum(len(y) for y in merged.values())
    print(f"\nDone. {total_artists} artists, {total_entries} year entries → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
