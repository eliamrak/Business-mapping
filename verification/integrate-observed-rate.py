"""Apply only the reviewed source delta to the exact preserved publisher checkout."""
import datetime
import hashlib
import subprocess
import sys

BASE = "ac97f05629a2259adf7000410e8114f3b927e929"
PUBLISHER = "8b9ca3095326d60ae3f99f7b53a666b54b89f749"
PUBLISHER_TREE = "98d1387e002344aa4be7814abed770f403ee8d10"


def git(*args, data=None):
    return subprocess.check_output(["git", *args], input=data)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def tree(ref):
    entries = git("ls-tree", "-rz", ref).split(b"\0")
    return dict(entry.split(b"\t", 1)[::-1] for entry in entries if entry)


def main():
    require(len(sys.argv) == 4, "Usage: python3 script.py CANDIDATE TREE PATCH_SHA256")
    candidate, expected_tree, expected_hash = sys.argv[1:]
    require(git("rev-parse", "HEAD").decode().strip() == PUBLISHER, "Publisher HEAD changed; stop and reconcile.")
    require(git("rev-parse", "HEAD^{tree}").decode().strip() == PUBLISHER_TREE, "Publisher tree changed.")
    require(not git("status", "--porcelain", "--untracked-files=all"), "Checkout is not clean; preserve and reconcile files.")
    remote = git("remote", "get-url", "github").decode().strip().lower()
    require(remote.removesuffix(".git").endswith("github.com/eliamrak/business-mapping"), "Unexpected established remote.")
    require(git("rev-parse", candidate + "^{tree}").decode().strip() == expected_tree, "Candidate tree mismatch.")
    require(git("rev-parse", candidate + "^").decode().strip() == BASE, "Candidate parent mismatch.")
    paths = git("diff", "--name-only", "-z", BASE, candidate).split(b"\0")[:-1]
    require(len(paths) == 11, "Unexpected delta path count.")
    before, base, after = tree("HEAD"), tree(BASE), tree(candidate)
    for path in paths:
        require(before.get(path) == base.get(path), "Publisher preimage differs: " + path.decode())
    patch = git("diff", "--no-ext-diff", "--no-color", "--no-renames", "--binary", "--full-index", "--src-prefix=a/", "--dst-prefix=b/", BASE, candidate)
    require(hashlib.sha256(patch).hexdigest() == expected_hash, "Reviewed patch hash mismatch.")
    git("apply", "--index", "--check", data=patch)
    rollback = "codex/practice-before-observed-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    git("branch", rollback, "HEAD")
    git("apply", "--index", data=patch)
    expected = before.copy()
    for path in paths:
        if path in after:
            expected[path] = after[path]
        else:
            expected.pop(path, None)
    staged = git("write-tree").decode().strip()
    require(tree(staged) == expected, "Unexpected staged tree; do not commit or publish.")
    require(not git("diff", "--name-only"), "Unexpected unstaged changes; do not publish.")
    print("PASS: reviewed delta staged; every other tracked path preserved.")
    print("Rollback reference:", rollback)
    print("Staged tree:", staged)
    print("Run release tests/types/builds, then create a normal descendant commit. Not published.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as exc:
        print("STOP:", str(exc), file=sys.stderr)
        sys.exit(1)
