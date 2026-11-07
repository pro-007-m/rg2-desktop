"""Unit checks only. No installer/process/GUI/registry mutations."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

import installer_lifecycle as qa


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.name = "unit-" + uuid.uuid4().hex
        self.root = qa.SANDBOXES / self.name
        qa.reject_reparse_ancestors(self.root)
        self.root.mkdir(parents=True)
        (self.root / ".qa-unit-owned").write_text(self.name, encoding="utf-8")
        self.package = self.root / "isolated-fake-setup.exe"
        self.package.write_bytes(b"not-executable-unit-fixture")
        self.data = {
            "qa_id": self.name, "sandbox_dir": str(self.root),
            "install_dir": str(self.root / "app"), "profile_dir": str(self.root / "profile"),
            "qa_app_id": "{90A17DA4-0323-43E2-AE06-18C97B52CD34}",
            "production_app_id": "{A6849F14-7FD7-48C6-8C8D-B6160DF1822B}",
            "qa_uninstall_key": qa.UNINSTALL_PREFIX + "{90A17DA4-0323-43E2-AE06-18C97B52CD34}_is1",
            "compiled_isolation": {"profile_override_verified": True, "no_postinstall_launch": True,
                                   "shortcuts_disabled": True, "profile_dir": str(self.root / "profile")},
            "uninstall_keep_args": ["/KEEPDATA=1"], "uninstall_purge_args": ["/PURGEDATA=1"],
            "packages": {kind: {"path": str(self.package), "version": version, "sha256": qa.sha256(self.package)}
                         for kind, version in [("baseline", "1.4.0"), ("upgrade", "1.4.1")]},
        }
        self.config = self.root / "reviewed-config.json"

    def write_config(self):
        self.config.write_text(json.dumps(self.data), encoding="utf-8")
        return self.config

    def tearDown(self):
        # One verified absolute unit-test target. No shell composition or user data.
        target = self.root.resolve()
        self.assertTrue(qa.contained(target, qa.BASE.resolve()))
        self.assertEqual((target / ".qa-unit-owned").read_text(encoding="utf-8"), self.name)
        qa.files_no_links(target)
        shutil.rmtree(target)

    def test_valid_config_is_strictly_isolated(self):
        config = qa.load_config(self.write_config())
        self.assertEqual(config["install"], self.root / "app")
        self.assertEqual(config["profile"], self.root / "profile")
        self.assertFalse(config["install"].exists())
        self.assertFalse(config["profile"].exists())

    def test_outside_profile_rejected(self):
        self.data["profile_dir"] = str(qa.BASE / "not-the-exact-sandbox")
        with self.assertRaises(ValueError):
            qa.load_config(self.write_config())

    def test_nested_profile_or_same_application_id_rejected(self):
        self.data["profile_dir"] = str(self.root / "app" / "profile")
        with self.assertRaises(ValueError):
            qa.load_config(self.write_config())
        self.data["profile_dir"] = str(self.root / "profile")
        self.data["qa_app_id"] = self.data["production_app_id"]
        with self.assertRaises(ValueError):
            qa.load_config(self.write_config())

    def test_installer_hash_and_compiled_profile_are_pinned(self):
        self.data["packages"]["baseline"]["sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            qa.load_config(self.write_config())
        self.data["packages"]["baseline"]["sha256"] = qa.sha256(self.package)
        self.data["compiled_isolation"]["profile_dir"] = str(self.root / "other-profile")
        with self.assertRaises(ValueError):
            qa.load_config(self.write_config())

    def test_guid_case_and_braces_cannot_disguise_production_identity(self):
        self.data["qa_app_id"] = self.data["production_app_id"].strip("{}").lower()
        self.data["qa_uninstall_key"] = qa.UNINSTALL_PREFIX + self.data["qa_app_id"] + "_is1"
        with self.assertRaises(ValueError):
            qa.load_config(self.write_config())

    def test_numeric_version_order_and_invalid_versions(self):
        self.assertGreater(qa.version("1.10.0"), qa.version("1.9.99"))
        self.assertEqual(qa.version("1.4"), qa.version("1.4.0.0"))
        for invalid in ["1.2.3.4.5", "1.65536.0", "1.2-beta", "-1.2.0"]:
            with self.assertRaises(ValueError):
                qa.version(invalid)

    def test_explicit_separate_qa_shortcuts_are_allowed_but_production_title_is_not(self):
        self.data["compiled_isolation"].update(shortcuts_disabled=False, shortcut_title="RG2 Installer QA")
        qa.load_config(self.write_config())
        self.data["compiled_isolation"]["shortcut_title"] = "RG2 Desktop"
        with self.assertRaises(ValueError):
            qa.load_config(self.write_config())

    def test_root_and_child_reparse_attributes_rejected(self):
        original = Path.lstat
        def reparse_for_package(path, *args, **kwargs):
            if path == self.package:
                return SimpleNamespace(st_mode=stat.S_IFREG, st_file_attributes=qa.REPARSE)
            return original(path, *args, **kwargs)
        with patch.object(Path, "lstat", reparse_for_package):
            with self.assertRaisesRegex(ValueError, "Reparse"):
                qa.reject_reparse_ancestors(self.package)
            with self.assertRaisesRegex(ValueError, "Reparse"):
                qa.files_no_links(self.root)

    def test_preflight_never_executes_installer(self):
        self.write_config()
        with patch.object(sys, "argv", ["installer_lifecycle.py", "--config", str(self.config)]), \
                patch.object(qa, "execute") as execute, contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(qa.main(), 0)
            execute.assert_not_called()
            self.assertIn("READ-ONLY PREFLIGHT", output.getvalue())

    def test_execute_requires_exact_reviewed_config_digest(self):
        self.write_config()
        with patch.object(sys, "argv", ["installer_lifecycle.py", "--config", str(self.config), "--execute", "--approve-config-sha256", "0" * 64]), \
                patch.object(qa, "execute") as execute, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "Execution denied"):
                qa.main()
            execute.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
