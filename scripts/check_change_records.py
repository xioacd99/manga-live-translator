#!/usr/bin/env python3
"""Validate staged changes and outgoing commits without modifying project files."""
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


class CheckError(Exception):
    """A check cannot pass safely."""


def git(*args, input=None):
    result = subprocess.run(["git", *args], input=input, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE)
    if result.returncode:
        # Do not echo remote URLs or authentication details from Git's stderr.
        raise CheckError("Git inspection failed. Check repository access and fetch the remote history before retrying.")
    return result.stdout


def tree(revision=None):
    entries = {}
    if revision is None:
        rows = git("ls-files", "--stage", "-z")
        for row in rows.split(b"\0"):
            if not row:
                continue
            meta, path = row.split(b"\t", 1)
            mode, oid, stage = meta.split()
            if stage != b"0":
                raise CheckError("Resolve and stage merge conflicts before committing.")
            entries[os.fsdecode(path)] = (mode, oid.decode())
    else:
        for row in git("ls-tree", "-r", "-z", revision).split(b"\0"):
            if not row:
                continue
            meta, path = row.split(b"\t", 1)
            mode, _, oid = meta.split()
            entries[os.fsdecode(path)] = (mode, oid.decode())
    return entries


def normalized(entry):
    if entry is None or entry[0] not in (b"100644", b"100755"):
        return b""
    content = git("cat-file", "blob", entry[1])
    try:
        return re.sub(r"\s+", "", content.decode("utf-8")).encode("utf-8")
    except UnicodeDecodeError:
        return b""


def record_path(path):
    parts = PurePosixPath(path).parts
    return (len(parts) >= 3 and parts[0] == "memory"
            and parts[1] != "templates" and path.endswith(".md")
            and parts[-1].lower() not in {"readme.md", "index.md"})


def validate(before, after, label):
    def changed(path):
        old, new = before.get(path), after.get(path)
        if old == new or (new is not None and new[1] in {entry[1] for entry in before.values()}):
            return False
        content = normalized(new)
        return bool(content) and content != normalized(old)

    missing = []
    if not changed("PUBLISH.md"):
        missing.append("a non-whitespace content update to PUBLISH.md")
    if not any(record_path(path) and changed(path) for path in after):
        missing.append("a non-whitespace update to a real memory/**/*.md record (not an index or template)")
    if missing:
        raise CheckError(label + " needs " + " and ".join(missing)
                         + ". Write accurate changes and evidence, then stage both files. "
                         "For an existing outgoing commit, amend/rework that commit; a later documentation-only commit does not repair it.")


def pre_commit():
    head = subprocess.run(["git", "rev-parse", "--verify", "HEAD"],
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if head.returncode == 0:
        before = tree(head.stdout.decode().strip())
    else:
        ref = git("symbolic-ref", "--quiet", "HEAD").decode().strip()
        exists = subprocess.run(["git", "show-ref", "--verify", "--quiet", ref])
        if exists.returncode != 1:
            raise CheckError("Cannot resolve HEAD reliably; repair repository state before committing.")
        before = {}
    validate(before, tree(), "Staged commit")


def zero(oid):
    return bool(oid) and set(oid) == {"0"}


def peeled_object(oid):
    if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", oid):
        raise CheckError("Invalid object ID in push input or remote advertisement.")
    peeled = git("rev-parse", "--verify", oid + "^{}").decode().strip()
    return peeled, git("cat-file", "-t", peeled).strip()


def commit_oid(oid):
    peeled, kind = peeled_object(oid)
    if kind != b"commit":
        raise CheckError("A pushed ref or history baseline does not point to a commit. Non-commit pushes are unsupported.")
    return peeled


def pre_push(remote, stream):
    updates = []
    for line in stream:
        fields = line.split()
        if len(fields) != 4:
            raise CheckError("Malformed pre-push input; cannot determine outgoing commits.")
        local_ref, local_oid, remote_ref, remote_oid = fields
        if zero(local_oid) or local_oid == remote_oid:
            continue
        updates.append((local_ref, local_oid, remote_ref, remote_oid))
    if not updates:
        return
    if git("rev-parse", "--is-shallow-repository").strip() != b"false":
        raise CheckError("Shallow history cannot be checked reliably. Fetch full history before pushing.")
    baseline = Path(".githooks/history-baseline").read_text().strip()
    exclusions = {commit_oid(baseline)}
    advertised = {}
    for line in git("ls-remote", "--refs", "--", remote).decode().splitlines():
        oid, ref = line.split("\t", 1)
        advertised[ref] = oid
        # Even unrelated missing objects can hide shared ancestry. Fail closed.
        peeled, kind = peeled_object(oid)
        if kind == b"commit":
            exclusions.add(peeled)
        elif kind not in (b"blob", b"tree"):
            raise CheckError("Unsupported advertised object type; cannot inspect remote history.")
    tips = set()
    for local_ref, local_oid, remote_ref, remote_oid in updates:
        current = advertised.get(remote_ref)
        expected = None if zero(remote_oid) else remote_oid
        if current != expected:
            raise CheckError("Remote refs changed during push inspection. Fetch and retry the push.")
        tips.add(commit_oid(local_oid))
    revisions = "\n".join(sorted(tips) + ["^" + oid for oid in sorted(exclusions)]) + "\n"
    commits = git("rev-list", "--reverse", "--topo-order", "--stdin",
                  input=revisions.encode()).decode().splitlines()
    for oid in commits:
        parents = git("rev-list", "--parents", "-n", "1", oid).decode().split()
        before = tree(parents[1]) if len(parents) > 1 else {}
        validate(before, tree(oid), "Outgoing commit " + oid[:12])


def main():
    try:
        os.environ["GIT_NO_LAZY_FETCH"] = "1"
        root = git("rev-parse", "--show-toplevel").decode().rstrip("\n")
        os.chdir(root)
        partial = subprocess.run(
            ["git", "config", "--get-regexp", r"^(extensions\.partialclone|remote\..*\.promisor)$"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if partial.returncode == 0:
            raise CheckError("Partial clones are unsupported. Use a full clone to avoid implicit object fetching.")
        if partial.returncode != 1:
            raise CheckError("Cannot inspect repository configuration reliably.")
        if len(sys.argv) == 2 and sys.argv[1] == "pre-commit":
            pre_commit()
        elif len(sys.argv) == 4 and sys.argv[1] == "pre-push":
            pre_push(sys.argv[3], sys.stdin)
        else:
            raise CheckError("Usage: check_change_records.py pre-commit | pre-push <remote-name> <remote-location>")
    except (CheckError, OSError, ValueError) as exc:
        print("Change-record check blocked: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
