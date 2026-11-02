"""Verify committed application data using only Python's standard library.

Run from any working directory: python tests/catalog.test.py
"""

from hashlib import sha256
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import unquote, urlsplit


DATA = Path(__file__).resolve().parents[1] / "data"


def read_json(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def local_file(value):
    """Reject remote, absolute and traversal paths before checking a resource."""
    assert isinstance(value, str) and value, "Empty resource path"
    url = urlsplit(value)
    assert not url.scheme and not url.netloc, "Nonlocal resource: " + value
    decoded = unquote(url.path)
    relative = PurePosixPath(decoded)
    assert not relative.is_absolute() and ".." not in relative.parts, "Unsafe resource path: " + value
    assert "\\" not in decoded, "Resource path must use forward slashes: " + value
    result = (DATA / decoded).resolve()
    assert DATA.resolve() in result.parents, "Resource escapes data directory: " + value
    assert result.is_file(), "Missing resource: " + value
    return result


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attributes):
        if tag == "img":
            source = dict(attributes).get("src")
            assert source, "HTML image has no src"
            self.sources.append(source)


def normalized_text(value):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", value))).strip()


def main():
    catalog = read_json("catalog.json")
    trainer = read_json("trainer-data.json")
    sources = read_json("original-apk-strings.json")
    manifest = read_json("original-assets-manifest.json")
    source_by_offset = {row["offset"]: row["text"] for row in sources}
    assert len(source_by_offset) == len(sources), "Duplicate original string offsets"

    phases = {phase["id"]: phase for phase in catalog["phases"]}
    assert len(phases) == len(catalog["phases"]), "Duplicate phase IDs"
    items = [item for phase in phases.values() for item in phase["items"]]
    records = items + catalog.get("extraPages", [])
    ids = [item["id"] for item in records]
    assert all(isinstance(value, str) and value for value in ids), "Empty item ID"
    assert len(ids) == len(set(ids)), "Duplicate item IDs"
    for phase in phases.values():
        assert [item["index"] for item in phase["items"]] == list(range(len(phase["items"]))), phase["id"]
    for category in catalog["categories"]:
        assert category["target_phase"] in phases, "Missing category target"
    assert catalog["defaultPhase"] in phases
    for alias, target in catalog.get("phaseAliases", {}).items():
        assert alias and target in phases, "Invalid phase alias: " + alias

    pages = []
    image_count = 0
    for item in records:
        assert item["title"].strip(), "Empty item title: " + item["id"]
        local_file(item["icon"])
        if item["kind"] == "submenu":
            assert item["target_phase"] in phases, "Missing submenu target: " + item["id"]
            continue
        assert item.get("html"), "Empty content: " + item["id"]
        offset = item["source_offset"]
        assert isinstance(offset, int) and offset in source_by_offset, "Missing source: " + item["id"]
        original = source_by_offset[offset]
        assert normalized_text(original) == normalized_text(item["html"]), "Source text changed: " + item["id"]
        assert sha256(original.encode("utf-8")).hexdigest() == item["source_html_sha256"], "Source hash changed: " + item["id"]
        parser = Images()
        parser.feed(item["html"])
        for image in parser.sources:
            local_file(image)
            image_count += 1
        if item.get("videoId"):
            assert re.fullmatch(r"[A-Za-z0-9_-]{11}", item["videoId"]), "Invalid video ID: " + item["id"]
        pages.append(item)

    reached = set()
    pending = [category["target_phase"] for category in catalog["categories"]]
    pending.append(catalog["toolsPhase"])
    while pending:
        phase_id = pending.pop()
        if phase_id in reached:
            continue
        reached.add(phase_id)
        pending.extend(item["target_phase"] for item in phases[phase_id]["items"] if item["kind"] == "submenu")
    assert reached == set(phases), "Unreachable phases: " + repr(sorted(set(phases) - reached))

    fragments = {'<p style="text-align:center">', "<img src=", '<img apath="'}
    original_html = {
        row["offset"] for row in sources
        if ("<p" in row["text"] or "<img" in row["text"]) and row["text"].strip() not in fragments
    }
    covered = {page["source_offset"] for page in pages}
    assert len(original_html) == 486, "Unexpected original HTML corpus size"
    assert original_html <= covered, "Original HTML pages missing: " + repr(sorted(original_html - covered))
    plain = {page["source_offset"] for page in pages if "<p" not in source_by_offset[page["source_offset"]] and "<img" not in source_by_offset[page["source_offset"]]}
    assert len(plain) == 19, "Plain teaching pages missing"
    assert len(covered) == 505, "Unexpected distinct content count"

    assert len(manifest) == 2063, "Original asset manifest count changed"
    asset_paths = [item["path"] for item in manifest]
    assert len(asset_paths) == len(set(asset_paths)), "Duplicate asset manifest paths"
    for item in manifest:
        resource = local_file("assets/" + item["path"])
        raw = resource.read_bytes()
        assert len(raw) == item["bytes"], "Asset length changed: " + item["path"]
        assert sha256(raw).hexdigest() == item["sha256"], "Asset hash changed: " + item["path"]
    actual_assets = {resource.relative_to(DATA / "assets").as_posix() for resource in (DATA / "assets").rglob("*") if resource.is_file()}
    assert actual_assets == set(asset_paths), "Original asset inventory differs"

    groups = trainer["notation"]
    assert len(groups) == 11 and len({group["id"] for group in groups}) == 11
    assert [len(group["items"]) for group in groups] == [36, 45, 57, 2, 8, 4, 16, 22, 4, 12, 6]
    vm_values = read_json("notation-vm-reference-evidence.json")["vm_reference_values"]
    moves = 0
    for group in groups:
        for item in group["items"]:
            assert isinstance(item["move"], str) and item["move"].strip() and "@string/" not in item["move"], "Unresolved notation move"
            assert isinstance(item["description"], str) and item["description"].strip(), "Empty notation description"
            assert source_by_offset[item["source_offset"]] == item["description"], "Notation description changed"
            if item.get("source_move_offset") is not None:
                assert source_by_offset[item["source_move_offset"]] == item["move"], "Notation formula changed"
            else:
                assert vm_values[str(item["source_move_ref"])] == item["move"], "Notation VM symbol changed"
            local_file(item["icon"])
            moves += 1
    assert moves == 212
    print(f"Catalog tests passed: {len(phases)} phases, {len(records)} records, 486 HTML + 19 plain pages, {len(manifest)} asset hashes, {image_count} image references, {moves} notation moves.")


if __name__ == "__main__":
    main()
