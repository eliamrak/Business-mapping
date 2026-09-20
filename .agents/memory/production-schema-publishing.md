---
name: Production schema publishing
description: Replit-managed production databases can lag development schema until a publish applies the schema diff.
---

The live database may not contain newly added authorization tables even when the development database does. Owner authentication should resolve the Clerk identity independently and fail closed for invited-user lookups until publishing applies the schema.

**Why:** A deployed Clerk session reached authorization while the production role table was absent, turning a valid owner sign-in into a 500 response.

**How to apply:** When adding database-backed authorization, keep the owner path independent of the role table, treat unavailable role storage as a denied invite lookup rather than a server error, and remind the user to publish after schema changes.