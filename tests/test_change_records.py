"""Integration checks in isolated repositories; no network or user config changes."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]
ZERO = "0" * 40


class HookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="manga hook tests ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / "work tree"
        self.repo.mkdir()
        self.remote = self.base / "bare remote.git"
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
                        GIT_AUTHOR_NAME="Test", GIT_AUTHOR_EMAIL="test@example.invalid",
                        GIT_COMMITTER_NAME="Test", GIT_COMMITTER_EMAIL="test@example.invalid")
        self.git("init", "-b", "topic")
        self.git("init", "--bare", str(self.remote))
        self.write("seed.txt", "old published initialization\n")
        self.git("add", ".")
        self.git("commit", "-m", "baseline")
        self.baseline = self.sha()
        for directory in (".githooks", "scripts"):
            shutil.copytree(SOURCE / directory, self.repo / directory,
                            ignore=shutil.ignore_patterns("__pycache__"))
        self.write(".githooks/history-baseline", self.baseline + "\n")
        self.git("config", "--local", "core.hooksPath", ".githooks")
        self.git("remote", "add", "origin", str(self.remote))
        self.count = 0

    def git(self, *args, input=None, ok=True):
        result = subprocess.run(["git", *args], cwd=self.repo, env=self.env,
                                input=input, text=True, capture_output=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def write(self, path, content):
        p = self.repo / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)

    def sha(self):
        return self.git("rev-parse", "HEAD").stdout.strip()

    def good(self):
        self.count += 1
        self.write("PUBLISH.md", f"# Updates\n- Change {self.count}\n")
        self.write("memory/development/practices/record with spaces.md",
                   f"# Finding\nVerified observation {self.count}\n")
        self.git("add", ".")
        self.git("commit", "-m", f"change {self.count}")
        return self.sha()

    def raw_commit(self, path="code.txt"):
        self.count += 1
        self.write(path, f"change {self.count}\n")
        self.git("add", ".")
        self.git("-c", "core.hooksPath=/dev/null", "commit", "-m", "missing records")
        return self.sha()

    def invoke_push(self, lines, remote=None):
        return subprocess.run([str(self.repo / ".githooks/pre-push"), "origin",
                               str(remote or self.remote)], cwd=self.repo, env=self.env,
                              input=lines, text=True, capture_output=True)

    def test_staged_only_and_real_record(self):
        self.write("PUBLISH.md", "actual change\n")
        self.write("MEMORY.md", "index only\n")
        self.write("memory/development/README.md", "index only\n")
        self.write("memory/templates/record.md", "template only\n")
        self.git("add", ".")
        self.assertNotEqual(self.git("commit", "-m", "blocked", ok=False).returncode, 0)
        self.write("memory/development/practices/real.md", "actual finding\n")
        self.assertNotEqual(self.git("commit", "-m", "unstaged", ok=False).returncode, 0)
        self.git("add", "memory/development/practices/real.md")
        self.git("commit", "-m", "allowed")

    def test_missing_publish_and_whitespace(self):
        self.good()
        self.write("memory/development/practices/new.md", "new finding\n")
        self.git("add", ".")
        self.assertNotEqual(self.git("commit", "-m", "no publish", ok=False).returncode, 0)
        self.write("PUBLISH.md", "# Updates\n\n-    Change 1\n")
        self.git("add", ".")
        self.assertNotEqual(self.git("commit", "-m", "whitespace", ok=False).returncode, 0)

    def test_mode_rename_and_delete_do_not_qualify(self):
        self.good()
        self.write("PUBLISH.md", "real second change\n")
        self.git("mv", "memory/development/practices/record with spaces.md", "memory/development/practices/renamed.md")
        self.git("add", ".")
        self.assertNotEqual(self.git("commit", "-m", "rename only", ok=False).returncode, 0)
        self.git("reset", "--hard", "HEAD")
        self.write("PUBLISH.md", "real second change\n")
        self.git("update-index", "--chmod=+x", "memory/development/practices/record with spaces.md")
        self.git("add", "PUBLISH.md")
        self.assertNotEqual(self.git("commit", "-m", "mode only", ok=False).returncode, 0)
        self.git("rm", "-f", "memory/development/practices/record with spaces.md")
        self.assertNotEqual(self.git("commit", "-m", "delete only", ok=False).returncode, 0)

    def test_first_push_and_existing_remote(self):
        self.good()
        self.git("push", "origin", "HEAD:refs/heads/not-main")
        self.good()
        self.git("push", "origin", "HEAD:refs/heads/not-main")

    def test_empty_range_deletion_and_new_branch_remote_ancestry(self):
        good = self.good()
        self.git("push", "origin", "HEAD:refs/heads/old-name")
        self.assertEqual(self.invoke_push("").returncode, 0)
        self.assertEqual(self.invoke_push(f"(delete) {ZERO} refs/heads/old-name {good}\n").returncode, 0)
        self.git("push", "origin", "HEAD:refs/heads/new-name")
        self.git("push", "origin", ":refs/heads/old-name")

    def test_each_commit_not_just_final_tree(self):
        self.good()
        self.git("push", "origin", "HEAD:refs/heads/topic")
        bad = self.raw_commit()
        self.good()
        result = self.git("push", "origin", "HEAD:refs/heads/topic", ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(bad[:12], result.stderr)

    def test_multiple_refs_do_not_assume_head(self):
        good = self.good()
        self.git("branch", "good", good)
        bad = self.raw_commit()
        self.git("branch", "bad", bad)
        self.git("checkout", "good")
        result = self.git("push", "origin", "good", "bad", ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(bad[:12], result.stderr)

    def test_remote_commits_are_not_rechecked(self):
        bad = self.raw_commit()
        self.git("-c", "core.hooksPath=/dev/null", "push", "origin", "HEAD:refs/heads/existing")
        self.git("push", "origin", "HEAD:refs/heads/another")
        self.assertEqual(self.sha(), bad)

    def test_remote_change_and_unavailable_remote_block(self):
        good = self.good()
        self.git("push", "origin", "HEAD:refs/heads/topic")
        result = self.invoke_push(f"refs/heads/topic {good} refs/heads/topic {ZERO}\n")
        self.assertNotEqual(result.returncode, 0)
        result = self.invoke_push(f"refs/heads/topic {good} refs/heads/new {ZERO}\n", self.base / "missing")
        self.assertNotEqual(result.returncode, 0)

    def test_missing_remote_object_blocks(self):
        self.good()
        self.git("push", "origin", "HEAD:refs/heads/topic")
        other = self.base / "other"
        self.git("clone", str(self.remote), str(other))
        subprocess.run(["git", "checkout", "-b", "unseen", "origin/topic"], cwd=other, env=self.env, check=True, capture_output=True)
        (other / "unseen").write_text("remote work")
        subprocess.run(["git", "add", "."], cwd=other, env=self.env, check=True)
        subprocess.run(["git", "commit", "-m", "remote"], cwd=other, env=self.env, check=True, capture_output=True)
        subprocess.run(["git", "push", "origin", "unseen"], cwd=other, env=self.env, check=True, capture_output=True)
        self.good()
        self.assertNotEqual(self.git("push", "origin", "HEAD:refs/heads/topic", ok=False).returncode, 0)

    def test_annotated_tag(self):
        self.good()
        self.git("tag", "-a", "v-test", "-m", "test tag")
        self.git("push", "origin", "v-test")
        self.git("push", "origin", "HEAD:refs/heads/from-tag")

    def test_unborn_commit(self):
        self.git("checkout", "--orphan", "root-branch")
        self.git("rm", "-rf", "--cached", ".")
        self.good()
        self.git("push", "origin", "HEAD:refs/heads/root-branch")

    def test_merge_commit_requires_its_own_records(self):
        self.good()
        self.git("push", "origin", "HEAD:refs/heads/topic")
        self.git("checkout", "-b", "side")
        self.good()
        self.git("checkout", "topic")
        self.git("merge", "--no-ff", "--no-commit", "side")
        self.git("commit", "-m", "merge with records")
        self.git("push", "origin", "HEAD:refs/heads/topic")
        self.git("checkout", "-b", "side-two")
        self.good()
        self.git("checkout", "topic")
        self.git("merge", "--no-ff", "--no-commit", "side-two")
        self.git("checkout", "HEAD", "--", "PUBLISH.md",
                 "memory/development/practices/record with spaces.md")
        self.git("-c", "core.hooksPath=/dev/null", "commit", "-m", "merge without records")
        self.assertNotEqual(self.git("push", "origin", "HEAD:refs/heads/topic", ok=False).returncode, 0)

    def test_force_push_checks_new_commits(self):
        first = self.good()
        self.git("push", "origin", "HEAD:refs/heads/topic")
        self.good()
        self.git("push", "origin", "HEAD:refs/heads/topic")
        self.git("reset", "--hard", first)
        self.good()
        self.git("push", "--force-with-lease", "origin", "HEAD:refs/heads/topic")
        self.git("reset", "--hard", first)
        self.raw_commit()
        self.assertNotEqual(self.git("push", "--force-with-lease", "origin", "HEAD:refs/heads/topic", ok=False).returncode, 0)

    def test_symlink_does_not_qualify(self):
        self.good()
        self.write("PUBLISH.md", "another update\n")
        record = self.repo / "memory/development/practices/record with spaces.md"
        record.unlink()
        record.symlink_to("../../../PUBLISH.md")
        self.git("add", ".")
        self.assertNotEqual(self.git("commit", "-m", "symlink", ok=False).returncode, 0)

    def test_remote_tag_to_blob_does_not_block_commit_push(self):
        self.good()
        blob = self.git("rev-parse", "HEAD:seed.txt").stdout.strip()
        self.git("tag", "-a", "blob-tag", blob, "-m", "blob tag")
        self.git("-c", "core.hooksPath=/dev/null", "push", "origin", "blob-tag")
        self.git("push", "origin", "HEAD:refs/heads/topic")

    def test_push_noncommit_tag_rejected_clearly(self):
        self.good()
        blob = self.git("rev-parse", "HEAD:seed.txt").stdout.strip()
        self.git("tag", "blob-tag", blob)
        result = self.git("push", "origin", "blob-tag", ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Non-commit pushes are unsupported", result.stderr)

    def test_partial_clone_rejected(self):
        self.git("config", "remote.origin.promisor", "true")
        result = self.invoke_push("")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Partial clones are unsupported", result.stderr)

    def test_automatic_merge_hook(self):
        self.good()
        self.git("checkout", "-b", "auto-side")
        self.raw_commit()
        self.git("checkout", "topic")
        result = self.git("merge", "--no-ff", "auto-side", "-m", "automatic merge", ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Change-record check blocked", result.stderr)

    def test_malformed_input_blocks(self):
        self.assertNotEqual(self.invoke_push("bad input\n").returncode, 0)

    def test_shallow_and_missing_baseline_block(self):
        good = self.good()
        self.write(".git/shallow", good + "\n")
        result = self.invoke_push(f"refs/heads/topic {good} refs/heads/topic {ZERO}\n")
        self.assertNotEqual(result.returncode, 0)
        (self.repo / ".git/shallow").unlink()
        self.write(".githooks/history-baseline", "1" * 40 + "\n")
        result = self.invoke_push(f"refs/heads/topic {good} refs/heads/topic {ZERO}\n")
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
