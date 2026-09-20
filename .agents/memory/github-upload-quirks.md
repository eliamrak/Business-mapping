---
name: GitHub upload quirks
description: Constraints when storing this workspace in GitHub through the Replit connector.
---

An empty GitHub repository must receive a first branch commit through the contents API before Git blob, tree, commit, and ref endpoints will accept a snapshot upload. The GitHub connector also rate-limits blob creation to roughly 10 requests per second, so uploads should be serialized or throttled with retry handling.

**Why:** The connector does not expose the workspace's internal Git remote credentials, so repository storage uses GitHub's authenticated REST API rather than a direct CLI push.

**How to apply:** For a new empty repository, bootstrap one tracked file, upload the remaining tracked files as blobs, create one tree and commit with the bootstrap commit as parent, then advance `main`.

When the REST-uploaded snapshot has unrelated history from the local branch, fetch the GitHub branch and merge it with the local tree preserved (`ours` strategy). This makes the GitHub tip an ancestor of the local branch without replacing local work.

**Why:** A direct push otherwise reports a non-fast-forward rejection even when the remote files already match the local project.

**How to apply:** Keep the local branch as the first parent, use the GitHub snapshot as the second parent, and set the local branch to track `github/main`.