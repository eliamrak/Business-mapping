---
name: Clerk authorization model
description: The dashboard's Clerk authentication and future internal-user authorization boundary.
---

The web dashboard uses Clerk browser session cookies rather than explicit bearer tokens. The configured owner email receives owner access; future invited emails are matched to the existing hub user records so their owner or data-entry role remains meaningful.

**Why:** The app needs a secure owner login now without closing off the planned internal-user invitation model later. Clinician presenter links are intentionally public and must remain exempt from the protected API gate.

**How to apply:** Keep provider/session work in Clerk, use email-to-role mapping for app authorization, and do not reintroduce the legacy local-password session as the web transport.