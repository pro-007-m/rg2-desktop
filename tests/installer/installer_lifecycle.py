"""Isolated Inno lifecycle QA. Default is READ-ONLY preflight, never installation.

Execution requires a parent-authorized exact configuration SHA-256. This script
does not interact with GUI; manual wizard/checkbox QA must use agent-desktop.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

try:
    import winreg
except ImportError:
    winreg = None

BASE = Path(__file__).resolve().parent
SANDBOXES = BASE / "sandboxes"
REPARSE = 0x400
UNINSTALL_PREFIX = r"Software\Microsoft\Windows\CurrentVersion\Uninstall" + "\\"
WEBVIEW_KEY = r"Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def contained(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return path != parent
    except ValueError:
        return False


def absolute(value: str) -> Path:
    path = Path(value)
    return Path(os.path.abspath(path if path.is_absolute() else BASE / path))


def reject_reparse_ancestors(path: Path) -> None:
    # Do not resolve() first: following a junction would hide its existence.
    for part in [path, *path.parents]:
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if info.st_mode & 0o170000 == 0o120000 or getattr(info, "st_file_attributes", 0) & REPARSE:
            raise ValueError(f"Reparse/symlink path is forbidden: {part}")


def files_no_links(root: Path) -> list[Path]:
    reject_reparse_ancestors(root)
    if not root.exists():
        return []
    result, pending = [], [root]
    while pending:
        current = pending.pop()
        for child in current.iterdir():
            info = child.lstat()
            if child.is_symlink() or getattr(info, "st_file_attributes", 0) & REPARSE:
                raise ValueError(f"Reparse point inside QA tree: {child}")
            if child.is_dir():
                pending.append(child)
            elif child.is_file():
                result.append(child)
    return sorted(result)


def manifest(root: Path) -> dict[str, str]:
    return {file.relative_to(root).as_posix(): sha256(file) for file in files_no_links(root)}


def version(value: str) -> tuple[int, int, int, int]:
    if not re.fullmatch(r"\d+(?:\.\d+){1,3}", value):
        raise ValueError(f"Use numeric 2–4 component versions: {value}")
    result = tuple(int(part) for part in value.split("."))
    if any(part > 65535 for part in result):
        raise ValueError("Version components must fit Windows packed versions")
    return result + (0,) * (4 - len(result))


def app_identity(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return value.casefold()


def load_config(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    test_id = data.get("qa_id", "")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{5,80}", test_id):
        raise ValueError("qa_id needs a distinct safe test name")
    sandbox = absolute(data["sandbox_dir"])
    expected_sandbox = Path(os.path.abspath(SANDBOXES / test_id))
    if sandbox != expected_sandbox:
        raise ValueError(f"Sandbox must be exactly {expected_sandbox}")
    install, profile = absolute(data["install_dir"]), absolute(data["profile_dir"])
    for path_value in [sandbox, install, profile]:
        reject_reparse_ancestors(path_value)
    if not contained(install, sandbox) or not contained(profile, sandbox):
        raise ValueError("Both QA app and profile must be strictly inside the exact sandbox")
    if install == profile or contained(install, profile) or contained(profile, install):
        raise ValueError("QA app and profile must be disjoint directories")
    app_id, production = data.get("qa_app_id", ""), data.get("production_app_id", "")
    if not app_id or not production or app_identity(app_id) == app_identity(production) or any("REPLACE" in value.upper() for value in [app_id, production]):
        raise ValueError("Supply distinct reviewed QA and production AppIds")
    if len(app_id) > 127 or any(char in app_id for char in "\\/\r\n"):
        raise ValueError("Invalid Inno AppId")
    expected_key = UNINSTALL_PREFIX + app_id + "_is1"
    if data.get("qa_uninstall_key") != expected_key:
        raise ValueError("QA uninstall key must match the isolated Inno AppId exactly")
    for key in data.get("qa_aux_registry_keys", []):
        if not isinstance(key, str) or not key.startswith("Software\\") or "installerqa" not in key.lower().replace(" ", ""):
            raise ValueError("Auxiliary QA registry keys must be explicit separate InstallerQA keys")
    isolation = data.get("compiled_isolation", {})
    shortcut_title = isolation.get("shortcut_title", "")
    safe_qa_shortcuts = isinstance(shortcut_title, str) and "Installer QA" in shortcut_title and not any(char in shortcut_title for char in "\\/\r\n")
    if not (isolation.get("profile_override_verified") is True and isolation.get("no_postinstall_launch") is True and (isolation.get("shortcuts_disabled") is True or safe_qa_shortcuts)):
        raise ValueError("Review compiled QA profile override, no-launch and shortcut isolation first")
    if absolute(isolation.get("profile_dir", "")) != profile:
        raise ValueError("Compiled installer purge target must exactly match the isolated QA profile")
    packages = {}
    for kind in ["baseline", "upgrade"]:
        package = data["packages"][kind]
        file = absolute(package["path"])
        reject_reparse_ancestors(file)
        if not file.is_file() or file.suffix.lower() != ".exe":
            raise ValueError(f"Missing compiled isolated {kind} installer: {file}")
        if not re.fullmatch(r"[0-9a-fA-F]{64}", package.get("sha256", "")) or sha256(file) != package["sha256"].lower():
            raise ValueError(f"Pinned installer hash mismatch: {kind}")
        version(package["version"])
        packages[kind] = {**package, "file": file}
    if version(packages["upgrade"]["version"]) <= version(packages["baseline"]["version"]):
        raise ValueError("Upgrade installer version must be numerically newer than baseline")
    for field in ["uninstall_keep_args", "uninstall_purge_args"]:
        values = data.get(field)
        if not isinstance(values, list) or not values or any(not isinstance(value, str) or "\n" in value or "\r" in value for value in values):
            raise ValueError(f"Review explicit custom uninstall mode arguments: {field}")
    if data["uninstall_keep_args"] == data["uninstall_purge_args"]:
        raise ValueError("Keep and purge must be distinct explicit modes")
    for relative in data.get("required_files", ["RG2.Desktop.exe", "data/index.html"]):
        if not contained(Path(os.path.abspath(install / relative)), install):
            raise ValueError("Required file escaped QA installation")
    data.update(sandbox=sandbox, install=install, profile=profile, reviewed_packages=packages)
    return data


def registry_values(hive, subkey: str, view: int = 0) -> dict | None:
    if winreg is None:
        raise RuntimeError("Execution requires Windows registry support")
    try:
        with winreg.OpenKey(hive, subkey, 0, winreg.KEY_READ | view) as key:
            result, index = {}, 0
            while True:
                try:
                    name, value, _ = winreg.EnumValue(key, index)
                except OSError:
                    break
                result[name] = value
                index += 1
            return result
    except FileNotFoundError:
        return None


def qa_registration(config: dict) -> dict | None:
    return registry_values(winreg.HKEY_CURRENT_USER, config["qa_uninstall_key"], winreg.KEY_WOW64_64KEY)


def auxiliary_qa_keys(config: dict) -> dict:
    return {key: registry_values(winreg.HKEY_CURRENT_USER, key, winreg.KEY_WOW64_64KEY) for key in config.get("qa_aux_registry_keys", [])}


def shared_runtime_snapshot() -> dict:
    result = {}
    for title, hive in [("HKCU", winreg.HKEY_CURRENT_USER), ("HKLM", winreg.HKEY_LOCAL_MACHINE)]:
        for bits, view in [("32", winreg.KEY_WOW64_32KEY), ("64", winreg.KEY_WOW64_64KEY)]:
            values = registry_values(hive, WEBVIEW_KEY, view)
            result[title + bits] = values.get("pv") if values else None
    for variable in ["ProgramFiles", "ProgramFiles(x86)"]:
        root = Path(os.environ.get(variable, "C:/Program Files")) / "dotnet" / "shared"
        result[variable + ":dotnet"] = sorted(str(path.relative_to(root)) for path in root.glob("*/*") if path.is_dir()) if root.exists() else []
    return result


def wait_for(predicate, description: str, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError("Timed out: " + description)


def run_installer(file: Path, arguments: list[str], log: Path, timeout: int) -> int:
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    process = subprocess.run([str(file), *arguments, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", f"/LOG={log}"],
                             startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW, timeout=timeout, check=False)
    return process.returncode


def execute(config: dict, config_hash: str) -> dict:
    if winreg is None:
        raise RuntimeError("Windows only")
    app, profile, sandbox = config["install"], config["profile"], config["sandbox"]
    if app.exists() or profile.exists() or qa_registration(config) is not None or any(value is not None for value in auxiliary_qa_keys(config).values()):
        raise ValueError("Clean QA install/profile/registry state required; nothing is auto-deleted")
    before_runtimes = shared_runtime_snapshot()
    if not any(value and value != "0.0.0.0" for name, value in before_runtimes.items() if name.startswith("HK")):
        raise ValueError("Local QA requires existing shared WebView2; missing-prerequisite tests belong in a disposable VM")
    sandbox.mkdir(parents=True, exist_ok=True)
    logs = sandbox / "logs"
    logs.mkdir(exist_ok=True)
    result = {"config_sha256": config_hash, "sandbox": str(sandbox), "steps": [], "shared_runtimes_before": before_runtimes}
    timeout = int(config.get("process_timeout_seconds", 1200))
    packages = config["reviewed_packages"]

    def installed(expected_version: str) -> None:
        values = qa_registration(config)
        assert values is not None, "Missing isolated uninstall registration"
        assert version(str(values.get("DisplayVersion", ""))) == version(expected_version), values
        assert config.get("expected_display_name_contains", "Installer QA").lower() in str(values.get("DisplayName", "")).lower(), values
        location = str(values.get("InstallLocation", "")).strip('"').rstrip("\\/")
        assert location and absolute(location) == app, values
        for key, values in auxiliary_qa_keys(config).items():
            assert values is not None, "Missing isolated auxiliary registration: " + key
            if "InstallDir" in values:
                assert absolute(str(values["InstallDir"])) == app, values
        for relative in config.get("required_files", ["RG2.Desktop.exe", "data/index.html"]):
            assert (app / relative).is_file(), f"Missing installed file {relative}"
        files_no_links(app)

    def install(kind: str, step: str, expected_profile: dict | None = None) -> None:
        files_no_links(app)
        files_no_links(profile)
        package = packages[kind]
        args = [f"/DIR={app}", "/NOCLOSEAPPLICATIONS", "/NORESTARTAPPLICATIONS", *config.get("extra_setup_args", [])]
        code = run_installer(package["file"], args, logs / (step + ".log"), timeout)
        assert code == 0, f"{step} failed with {code}"
        installed(package["version"])
        if expected_profile is not None:
            assert manifest(profile) == expected_profile, f"{step} changed preserved profile data"
        result["steps"].append({"step": step, "exit_code": code, "version": package["version"]})

    def uninstall(mode: str, expected_profile: dict | None) -> None:
        files_no_links(app)
        files_no_links(profile)
        # Use the isolated recorded uninstaller only; never parse/run a registry command.
        name = config.get("uninstaller_relative", "unins000.exe")
        uninstaller = Path(os.path.abspath(app / name))
        assert contained(uninstaller, app) and uninstaller.is_file(), "Unsafe/missing QA uninstaller"
        code = run_installer(uninstaller, config["uninstall_" + mode + "_args"], logs / ("uninstall-" + mode + ".log"), timeout)
        assert code == 0, f"Uninstall {mode} failed with {code}"
        wait_for(lambda: qa_registration(config) is None and not app.exists() and all(value is None for value in auxiliary_qa_keys(config).values()), "isolated app and all QA registry keys removed")
        if mode == "keep":
            assert manifest(profile) == expected_profile, "Keep mode deleted/changed user data or staged updates"
        else:
            wait_for(lambda: not profile.exists(), "isolated profile including staged updates purged")
        result["steps"].append({"step": "uninstall-" + mode, "exit_code": code})

    try:
        install("baseline", "clean-install")
        profile.mkdir(parents=True, exist_ok=True)
        ownership = config.get("profile_ownership_marker")
        if ownership:
            marker = Path(os.path.abspath(profile / ownership["relative"]))
            assert contained(marker, profile)
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(ownership["content"], encoding="utf-8")
        for relative, content in {
            "qa-user-settings.json": '{"theme":"graphite","qaSentinel":"preserve-this-profile"}',
            "WebView2/Default/qa-storage-sentinel.bin": "RG2-QA-browser-profile-sentinel",
            "updates/staged/qa-staged-update-sentinel.bin": "RG2-QA-staged-update-sentinel",
        }.items():
            file = profile / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            with file.open("xb") as stream:
                stream.write(content.encode("utf-8"))
        preserved = manifest(profile)
        install("upgrade", "upgrade", preserved)
        repair_file = Path(os.path.abspath(app / config.get("repair_remove_file", "data/index.html")))
        assert contained(repair_file, app) and repair_file.is_file()
        repair_hash = sha256(repair_file)
        repair_file.unlink()  # One exact installer-owned file inside the checked QA root.
        install("upgrade", "same-version-repair", preserved)
        assert sha256(repair_file) == repair_hash, "Repair did not restore the owned payload"
        payload_before = manifest(app)
        code = run_installer(packages["baseline"]["file"], [f"/DIR={app}", "/NOCLOSEAPPLICATIONS", "/NORESTARTAPPLICATIONS"], logs / "downgrade-block.log", timeout)
        assert code != 0, "Older installer must be blocked"
        installed(packages["upgrade"]["version"])
        assert manifest(app) == payload_before and manifest(profile) == preserved, "Blocked downgrade changed files/profile"
        result["steps"].append({"step": "downgrade-block", "exit_code": code})
        uninstall("keep", preserved)
        install("upgrade", "reinstall-after-keep", preserved)
        uninstall("purge", None)
        result["shared_runtimes_after"] = shared_runtime_snapshot()
        assert result["shared_runtimes_after"] == before_runtimes, "Shared WebView2/.NET state changed; inspect external updates/logs"
        result["passed"] = True
        return result
    except Exception as error:
        result["failure"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        # Preserve all QA evidence on failure. Never recursively clean any path here.
        result.setdefault("passed", False)
        (logs / "lifecycle-result.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--execute", action="store_true", help="Only after parent authorizes this exact isolated config")
    parser.add_argument("--approve-config-sha256", default="")
    args = parser.parse_args()
    config_hash = sha256(args.config)
    config = load_config(args.config)
    plan = {"mode": "EXECUTE" if args.execute else "READ-ONLY PREFLIGHT", "config_sha256": config_hash,
            "install_dir": str(config["install"]), "profile_dir": str(config["profile"]), "qa_uninstall_key": config["qa_uninstall_key"],
            "steps": ["clean-install", "profile+staged-update sentinel", "upgrade", "same-version repair", "downgrade block", "uninstall keep", "reinstall", "uninstall purge"]}
    print(json.dumps(plan, indent=2, ensure_ascii=False))
    if not args.execute:
        print("No installer launched. Authorize the exact config hash before --execute.")
        return 0
    if args.approve_config_sha256.lower() != config_hash:
        raise ValueError("Execution denied: acknowledge the reviewed exact config SHA-256")
    print(json.dumps(execute(config, config_hash), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"QA STOPPED: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1)
