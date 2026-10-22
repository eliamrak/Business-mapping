"""Stage the reviewed quarterly-only delta on the exact preserved publisher."""
import datetime
import hashlib
import os
import subprocess
import sys

BASE = "46bffcf3dffd39733f62625a26896d65201533b8"
PUBLISHER = "7de1bdc8a843e75fd8b65ebb86a8f43dc5830a5d"
PUBLISHER_TREE = "781a3e5c40ba6b1ebeedd5f40af34f566530e2b1"


def git(*args, data=None):
    return subprocess.check_output(["git", *args], input=data)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def tree(ref):
    return dict(entry.split(b"\t", 1)[::-1] for entry in git("ls-tree", "-rz", ref).split(b"\0") if entry)


def main():
    require(len(sys.argv) == 4, "Usage: python3 script.py CANDIDATE TREE PATCH_SHA256")
    candidate, expected_tree, expected_hash = sys.argv[1:]
    require(git("rev-parse", "HEAD").decode().strip() == PUBLISHER, "Publisher HEAD changed; stop and reconcile.")
    require(git("rev-parse", "HEAD^{tree}").decode().strip() == PUBLISHER_TREE, "Publisher tree changed.")
    require(not git("status", "--porcelain", "--untracked-files=all"), "Checkout is not clean; preserve and reconcile files.")
    remote = git("remote", "get-url", "github").decode().strip().lower().removesuffix(".git")
    require(remote == "https://github.com/eliamrak/business-mapping", "Unexpected established remote.")
    require(git("rev-parse", candidate + "^{tree}").decode().strip() == expected_tree, "Candidate tree mismatch.")
    require(git("rev-parse", candidate + "^").decode().strip() == BASE, "Candidate parent mismatch.")
    paths = git("diff", "--name-only", "-z", BASE, candidate).split(b"\0")[:-1]
    require(len(paths) == 12, "Unexpected delta path count.")
    before, base, after = tree("HEAD"), tree(BASE), tree(candidate)
    for path in paths:
        require(before.get(path) == base.get(path), "Publisher preimage differs: " + path.decode())
        if path in before:
            require(git("hash-object", "--", path).strip() == before[path].split()[-1], "Working preimage differs: " + path.decode())
        else:
            require(not os.path.lexists(os.fsdecode(path)), "Added path already exists: " + path.decode())
    patch = git("diff", "--no-ext-diff", "--no-color", "--no-renames", "--binary", "--full-index", "--src-prefix=a/", "--dst-prefix=b/", BASE, candidate)
    require(hashlib.sha256(patch).hexdigest() == expected_hash, "Reviewed patch hash mismatch.")
    git("apply", "--index", "--check", data=patch)
    rollback = "codex/practice-before-quarterly-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
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
    print("PASS: reviewed quarterly delta staged; all other tracked entries preserved.")
    print("Rollback reference:", rollback)
    print("Staged tree:", staged)
    print("Run release checks and create a normal descendant commit. Not published.")
    print("After quarterly records are saved, source backout must retain quarterly reader support; never rewrite records to fit the old enum.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as exc:
        print("STOP:", str(exc), file=sys.stderr)
        sys.exit(1)
