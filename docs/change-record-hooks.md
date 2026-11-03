# Change-Record Hooks

## Install in each local clone

Requirements: Git, a POSIX shell (including Git Bash), and Python 3.9 or newer available as `python3`. Tests currently run on Linux; other operating systems are not yet verified.

Cloning does not activate versioned hooks. From the repository root, first inspect any existing hook configuration:

```sh
git config --show-origin --get core.hooksPath
```

No output with exit status 1 means no configured path. If you already use hooks, review how to combine them before replacing that configuration. To explicitly enable this repository's hooks for this clone only:

```sh
git config --local core.hooksPath .githooks
git config --local --get core.hooksPath
```

The second command should print `.githooks`. The hook scripts are tracked as executable files. No installer runs automatically, and this change does not activate hooks in anyone else's clone.

## Required changes

Every development commit must contain both:

- A content change to the root `PUBLISH.md` (uppercase).
- A content change to at least one real Markdown record below `memory/`, such as `memory/development/practices/change-record-hooks.md`.

The root `MEMORY.md`, category `README.md` / `index.md` files, and files below `memory/templates/` do not count as experience records. Deletions, symlinks, mode-only changes, unchanged copies/renames, and whitespace-only edits do not satisfy the check. Paths containing spaces are supported.

Write accurate records based on the actual work. Updating an existing record with newly verified behavior, applicability, or limitations is preferable to creating repetitive entries. The hook can verify file/content changes, not the truth or usefulness of prose. It never generates notes, invokes an LLM, stages files, commits, or pushes for you.

`pre-commit` checks the staged snapshot against HEAD, not unstaged work. `pre-merge-commit` applies the same check to automatic merges. Stage both updates before committing. An amend is also compared to the current HEAD at this stage, so merely reusing its existing notes can be blocked; stage accurate updates for the amend. The push check validates each final commit against its first parent (an empty tree for root commits).

## Push boundaries

`pre-push` reads every ref update provided by Git, rather than assuming HEAD, main, or one ref. It checks every commit newly reachable from the outgoing tips, excluding commits reachable from the destination's currently advertised refs. Adding a branch or tag pointing only to existing remote history, deleting refs, or an empty update range requires no new record. Merges and force pushes are checked too; a later good commit does not repair an earlier bad commit in the same outgoing range.

The fixed historical baseline in `.githooks/history-baseline` is `bd39fa3ab0d95b73851c29a785a87a665d067b5b`, the published project setup before this requirement. That commit and its ancestors are grandfathered even when pushing to a new empty remote. Do not advance this baseline to bypass checks. New roots and branches are checked; only ancestry actually covered by the baseline or advertised remote history is excluded.

The hook performs a read-only `git ls-remote` against the exact push destination. It does not fetch. Missing remote objects, an unavailable destination, changed destination ref OIDs, shallow history, or a missing baseline block the push. Partial clones are unsupported and lazy fetching is disabled during inspection. Annotated tags are peeled for ancestry; remote tags to blobs/trees do not add commit ancestry. Newly pushed non-commit refs are explicitly unsupported.

For missing remote objects, fetch the destination's full branches and tags yourself, then retry. For a conventional remote named `origin`, a starting point is:

```sh
git fetch origin '+refs/heads/*:refs/remotes/origin/*' --tags
```

Use the actual push destination if it differs from the fetch URL; additional advertised custom refs may need explicit fetching. Do not overwrite conflicting local tags blindly. For shallow clones, obtain complete history; for partial clones, use a full clone. The destination snapshot is not a server-side transaction, so concurrent remote changes can require a retry.

## Limits and tests

Local hooks are a development guardrail, not server-side enforcement. `--no-verify`, changed hook configuration, some history-editing tools, and direct GitHub/API writes can bypass them. No CI or server-side rule is installed. Agents must follow the documentation requirement even when using an API that does not run hooks.

Run the isolated integration tests from the repository root:

```sh
python3 -m unittest discover -s tests -v
```

Tests create temporary repositories and local bare remotes, activate hooks only in those fixtures, and do not use the network or modify your Git configuration.
