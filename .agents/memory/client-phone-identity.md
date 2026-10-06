---
name: Client phone identity
description: Confirmi's required Algerian mobile-number formats and shared client identity.
---

Algerian mobile client numbers must start with 05, 06, or 07 followed by 8 digits. Accept local format and the equivalent 213 / +213 international format as one client.

**Why:** The user specified these prefixes and length to prevent clients from bypassing their score by changing number format.

**How to apply:** Validate numbers on the server and canonicalize them before storing transactions, looking up scores, or updating score history.
