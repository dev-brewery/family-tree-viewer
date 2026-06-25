# Gramps Web API — Real Response Shapes (Phase 1 truth-test)

**Captured:** 2026-06-25 against a live Gramps Web instance (`http://your-gramps-host:5050/`).
**Gramps tree:** 291 people, 87 families, 1666 citations.
**Auth account used:** a read-only Gramps account (`<viewer-user>` / `<viewer-pass>`).

> These are *observed* shapes from the live endpoint. Every Phase 3a fix keys off this file.

---

## Authentication

- **Anonymous read is DISABLED.** `GET /api/people/` → `401`; `/api/metadata/` →
  `{"message":"Missing JWT in headers..."}`. The viewer **must** authenticate.
- `owner/owner` (old README test creds) → `403 Invalid username or password`. Do not use.

### `POST /api/token/`
Request: `{"username": "...", "password": "..."}` (JSON).
Response:
```json
{ "access_token": "<jwt>", "refresh_token": "<jwt>" }
```
- Field is **`access_token`** (current code reads `data.access_token` ✓).
- Also returns **`refresh_token`** — use with `POST /api/token/refresh/`
  (`Authorization: Bearer <refresh_token>`) for silent refresh before expiry.
- Send the access token as `Authorization: Bearer <access_token>` on every call.

---

## People — `GET /api/people/`

### CRITICAL: birth/death/place only appear under `?profile=`
Without a profile param the object has **no** top-level `birth`/`death`/`place`.
The current code reads `p.birth.date` / `p.death.date` / `p.birth.place` → **always blank.**
That is the root cause of missing dates/places.

Use **`?profile=all`** (or `self`). Then:

```jsonc
{
  "handle": "103529d7280c42c160b3480f777b",   // <-- relationship key
  "gramps_id": "I13011105",
  "gender": 0,                                  // 0=Female, 1=Male, 2=Unknown
  "primary_name": {
    "first_name": "Margaret",
    "surname_list": [ { "surname": "...", "primary": true } ]
  },
  "media_list": [ { "ref": "<media_handle>", "rect": [] } ],
  "profile": {
    "birth": {
      "date": "1808",                          // <-- ALREADY A STRING, not a date object
      "place": "Tennessee, United States",
      "place_name": "Tennessee, United States",
      "type": "Birth"
    },
    "death": {
      "date": "1891",
      "place": "Chattanooga, Hamilton, Tennessee, United States",
      "age": "83 years",
      "type": "Death"
    },
    "events": [ /* full event list, same string shape */ ]
  }
}
```

**Implications for `api.js`:**
- Fetch with `?profile=all` (drop/keep `extend=families` as needed).
- Read `p.profile.birth.date` (string) — **do not** call `formatGrampsDate()` on it;
  the profile already formats dates as display strings. `formatGrampsDate()` was written
  for the raw `date` *object* (`{year, month, day, text, dateval}`) which is NOT what
  `profile` returns. Either delete it or only apply it to raw `primary_name.date`.
- Read `p.profile.birth.place` (string), `p.profile.death.date`, `p.profile.death.place`.
- Name: `p.primary_name.first_name` + `p.primary_name.surname_list[0].surname` (current ✓).
- Gender mapping `1→M, 0→F` (current ✓).
- "Living" = no `profile.death` (or no `death_ref_index`). Current `!p.death` is wrong
  post-profile — use `!p.profile?.death`.

Pagination: response is a **bare JSON array** (not `{data:[]}`/`{results:[]}`).
`hasMore = data.length === pagesize`. Current array branch handles this ✓.

---

## Families — `GET /api/families/?profile=all`

```jsonc
{
  "handle": "...",
  "gramps_id": "...",
  "father_handle": "103529d73e2814b8b357bf4d8b8e",   // may be "" / missing
  "mother_handle": "103529d760be10f532db2d56fde5",
  "child_ref_list": [
    { "ref": "103529d73e2814b8b357bf4d8b8e", "frel": "Birth", "mrel": "Birth" }
  ]
}
```
- `father_handle` / `mother_handle` / `child_ref_list[].ref` — current
  `transformToFamilyChart()` already reads these correctly ✓. No change needed for
  relationship wiring; it just needs people fetched WITH profile so cards have data.

---

## Media / Photos — `GET /api/media/...`

- Person → `media_list[].ref` is a **media handle**.
- File endpoint `GET /api/media/{handle}/file` and
  `GET /api/media/{handle}/thumbnail/{size}` both currently return **404 / 403** —
  the binary files were not uploaded with this GEDCOM (metadata-only import).
- **Therefore:** implement photos with a hard **fallback to initials** and treat any
  non-200 as "no photo". For `<img>` tags that can't send headers, the API accepts
  the token as a `?jwt=<access_token>` query param (verified the param is honored;
  it still 403s here only because the files are absent).

---

## Quick verification recipe
```bash
B=http://your-gramps-host:5050
AT=$(curl -s -X POST "$B/api/token/" -H "Content-Type: application/json" \
      -d '{"username":"<viewer-user>","password":"<viewer-pass>"}' \
      | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
curl -s "$B/api/people/?page=1&pagesize=1&profile=all" -H "Authorization: Bearer $AT"
```
