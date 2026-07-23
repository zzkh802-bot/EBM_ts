# Local Guideline Source Library

Place pre-parsed large guideline documents here so `web_read` can reuse them without reparsing long PDFs.

Expected layout:

```text
data/source_library/guidelines/<slug>/
  metadata.json
  full.md
  toc.md              # optional
  source.pdf          # optional, usually not committed
```

Minimal `metadata.json`:

```json
{
  "title": "KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease",
  "source_url": "https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf",
  "organization": "KDIGO",
  "year": 2024,
  "pages": 199,
  "parsed_by": "mineru"
}
```

`web_read` matches by exact `source_url` and archives `full.md` into the current session as a normal readable source.
Large source PDFs and parsed documents can be kept locally but should not be committed unless explicitly needed.
