---
name: email_analysis
description: Analyze emails for category, importance, and concise summary in EmailClaw.
---

# Email Analysis Skill

When asked to analyze an email for EmailClaw, return only valid JSON.

Use this schema:

```json
{
  "category": "work",
  "confidence": 0.8,
  "classificationReasoning": "Reason for the category.",
  "importance": 7,
  "importanceReasoning": "Reason for the importance score.",
  "summary": "Short summary of the email."
}
```

Rules:

- `category` must be one of `work`, `personal`, `shopping`, `marketing`, `spam`, or `other`.
- `confidence` must be between 0 and 1.
- `importance` must be an integer between 0 and 10.
- Keep the summary concise.
- Do not include Markdown, code fences, or extra text outside the JSON object.
