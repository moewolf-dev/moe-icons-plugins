#!/usr/bin/env python3
"""Fail closed if a VSIX embeds icon payloads or a renamed aggregate archive."""

import json
import re
import stat
import sys
import zipfile
from pathlib import PurePosixPath

MAX_VSIX_BYTES = 64 * 1024 * 1024
MAX_EXPANDED_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_FILES = 512
VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta)(?:\.(0|[1-9]\d*))?)?$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
ICON_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
STYLE_GROUP = re.compile(r"^moe-[a-z0-9]+(?:-[a-z0-9]+)*$")
LOGO = "extension/moeicons-logo-192x192.png"
ROOT_FILES = {
    "[Content_Types].xml",
    "extension.vsixmanifest",
    "extension/LICENSE.txt",
    "extension/changelog.md",
    "extension/moeicons-logo-192x192.png",
    "extension/package.json",
    "extension/readme.md",
}
DATA_FILES = {
    "extension/data/error-codes.json",
    "extension/data/icons.json",
    "extension/data/release-state.json",
    "extension/data/version-map.json",
}
ARCHIVE_SUFFIXES = (".zip", ".vsix", ".tgz", ".tar", ".gz", ".7z", ".rar", ".zst", ".xz")
ICON_SUFFIXES = (".png", ".webp", ".jpg", ".jpeg", ".gif", ".avif", ".svg", ".bmp", ".tif", ".tiff", ".ico", ".bin")


def fail(message):
    raise ValueError(message)


def safe_name(info):
    name = info.filename
    if not name or "\\" in name or name.startswith("/"):
        fail("VSIX contains an unsafe path")
    path = PurePosixPath(name.rstrip("/"))
    if not path.parts or any(part in ("", ".", "..") for part in path.parts):
        fail("VSIX contains an unsafe path")
    if name != str(path) and name != str(path) + "/":
        fail("VSIX contains a non-canonical path")
    return str(path)


def allowed_path(name):
    if name in ROOT_FILES or name in DATA_FILES:
        return True
    if name.startswith("extension/docs/") and name.lower().endswith(".md"):
        return True
    if name.startswith("extension/dist/") and name.lower().endswith((".js", ".cjs")):
        return True
    return False


def validate_icon_index(raw, require_package_set=False):
    if not isinstance(raw, dict) or raw.get("schemaVersion") not in (1, 2):
        fail("VSIX icon index schema is invalid")
    if not isinstance(raw.get("entries"), list) or not raw["entries"] or len(raw["entries"]) > 100_000:
        fail("VSIX icon index entry count is invalid")

    if raw["schemaVersion"] == 1:
        if require_package_set:
            fail("VSIX release requires package-set schema v2 icon metadata")
    else:
        if set(raw) != {"schemaVersion", "resourceVersion", "sourceCommit", "candidateSets", "entries"}:
            fail("VSIX package-set icon index fields are invalid")
        if not isinstance(raw.get("resourceVersion"), str) or not VERSION.fullmatch(raw["resourceVersion"]):
            fail("VSIX package-set resource version is invalid")
        if not isinstance(raw.get("sourceCommit"), str) or not COMMIT.fullmatch(raw["sourceCommit"]):
            fail("VSIX package-set Source commit is invalid")
        candidate_sets = raw.get("candidateSets")
        if not isinstance(candidate_sets, dict) or set(candidate_sets) != {"free", "pro"}:
            fail("VSIX package-set candidate roots are invalid")
        for tier in ("free", "pro"):
            candidate = candidate_sets[tier]
            expected_fields = {"tier", "fullVersion", "sourceCommit", "generatorCommit", "packageSetSha256", "candidateRootSha256", "candidateRootBytes"}
            if not isinstance(candidate, dict) or set(candidate) != expected_fields:
                fail("VSIX package-set candidate binding fields are invalid")
            if (candidate.get("tier") != tier or candidate.get("fullVersion") != raw["resourceVersion"]
                    or candidate.get("sourceCommit") != raw["sourceCommit"]
                    or not isinstance(candidate.get("generatorCommit"), str) or not COMMIT.fullmatch(candidate["generatorCommit"])
                    or not isinstance(candidate.get("packageSetSha256"), str) or not SHA256.fullmatch(candidate["packageSetSha256"])
                    or not isinstance(candidate.get("candidateRootSha256"), str) or not SHA256.fullmatch(candidate["candidateRootSha256"])
                    or type(candidate.get("candidateRootBytes")) is not int or not 1 <= candidate["candidateRootBytes"] <= 1024 * 1024):
                fail("VSIX package-set candidate binding is invalid")
        if candidate_sets["free"]["packageSetSha256"] == candidate_sets["pro"]["packageSetSha256"]:
            fail("VSIX Free and Pro package-set identities must differ")
        seen_entries = set()
        for entry in raw["entries"]:
            if not isinstance(entry, dict) or set(entry) != {"id", "styleGroup", "minimumTier"}:
                fail("VSIX package-set icon entry fields are invalid")
            if (not isinstance(entry.get("id"), str) or not ICON_ID.fullmatch(entry["id"])
                    or not isinstance(entry.get("styleGroup"), str) or not STYLE_GROUP.fullmatch(entry["styleGroup"])
                    or entry.get("minimumTier") not in ("free", "pro")):
                fail("VSIX package-set icon entry is invalid")
            identity = (entry["styleGroup"], entry["id"])
            if identity in seen_entries:
                fail("VSIX package-set icon index contains duplicate entries")
            seen_entries.add(identity)

    def visit(value):
        if isinstance(value, str):
            if len(value) > 1024 or re.search(r"data:image/|https?://", value, re.IGNORECASE):
                fail("VSIX icon index contains embedded payload data or remote URLs")
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, dict):
            for item in value.values():
                visit(item)

    visit(raw)


def validate_release_binding(index, package, state):
    if not isinstance(package, dict) or package.get("name") != "moe-icons-plugins" or not isinstance(package.get("version"), str) or not VERSION.fullmatch(package["version"]):
        fail("VSIX extension identity is invalid")
    if not isinstance(state, dict) or state.get("schemaVersion") != 1 or not isinstance(state.get("current"), dict) or not isinstance(state.get("events"), list):
        fail("VSIX release state is invalid")
    current = state["current"]
    if current.get("pluginVersion") != package["version"] or current.get("resourceVersion") != index["resourceVersion"]:
        fail("VSIX package-set metadata differs from the current release baseline")
    matches = [
        item for item in state["events"]
        if isinstance(item, dict) and item.get("pluginVersion") == package["version"]
        and isinstance(item.get("event"), dict)
        and item["event"].get("resourceVersion") == index["resourceVersion"]
    ]
    if len(matches) != 1:
        fail("VSIX package-set metadata has no unique release event binding")
    event = matches[0]["event"]
    binding = event.get("packageSets")
    if not isinstance(binding, dict) or set(binding) != {"schemaVersion", "resourceVersion", "sourceCommit", "generatorCommit", "free", "pro"}:
        fail("VSIX package-set release event is missing its exact candidate binding")
    if (binding.get("schemaVersion") != 1 or binding.get("resourceVersion") != index["resourceVersion"]
            or binding.get("sourceCommit") != index["sourceCommit"] or event.get("sourceCommit") != index["sourceCommit"]
            or not isinstance(binding.get("generatorCommit"), str) or not COMMIT.fullmatch(binding["generatorCommit"])):
        fail("VSIX package-set release event identity differs from the index")
    for tier in ("free", "pro"):
        expected = binding[tier]
        actual = index["candidateSets"][tier]
        if not isinstance(expected, dict) or set(expected) != {"packageSetSha256", "candidateRootSha256", "candidateRootBytes"}:
            fail("VSIX release event candidate root fields are invalid")
        if (actual["tier"] != tier or actual["fullVersion"] != index["resourceVersion"]
                or actual["sourceCommit"] != binding["sourceCommit"] or actual["generatorCommit"] != binding["generatorCommit"]
                or actual["packageSetSha256"] != expected.get("packageSetSha256")
                or actual["candidateRootSha256"] != expected.get("candidateRootSha256")
                or actual["candidateRootBytes"] != expected.get("candidateRootBytes")):
            fail("VSIX package-set roots differ from the accepted release event")


def nested_payload_signature(name, data):
    lower = name.lower()
    if lower.endswith(ICON_SUFFIXES) and name != LOGO:
        return True
    if lower.endswith(ARCHIVE_SUFFIXES):
        return True
    if name == LOGO:
        return not data.startswith(b"\x89PNG\r\n\x1a\n")
    if data.startswith((
        b"\x1f\x8b", b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08",
        b"\xfd7zXZ\x00", b"7z\xbc\xaf\x27\x1c", b"Rar!\x1a\x07",
        b"BZh", b"\x28\xb5\x2f\xfd", b"\x04\x22\x4d\x18", b"!<arch>\n",
    )):
        return True
    if len(data) >= 262 and data[257:262] == b"ustar":
        return True
    if data.startswith((
        b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF87a", b"GIF89a",
        b"BM", b"II*\x00", b"MM\x00*", b"\x00\x00\x01\x00",
    )):
        return True
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in (b"avif", b"avis", b"mif1"):
        return True
    text = data.removeprefix(b"\xef\xbb\xbf").lstrip()[:4096].lower()
    if text[:256].startswith((b"<svg", b"<?xml")) and b"<svg" in text:
        return True
    return False


def verify(path, require_package_set=False):
    try:
        compressed_size = __import__("os").path.getsize(path)
        if compressed_size <= 0 or compressed_size > MAX_VSIX_BYTES:
            fail("VSIX exceeds the compressed package budget")
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if not infos or len(infos) > MAX_FILES:
                fail("VSIX file count is outside its budget")
            names = [safe_name(info) for info in infos]
            if len(set(names)) != len(names):
                fail("VSIX contains duplicate paths")
            total = 0
            contents = {}
            for info, name in zip(infos, names):
                mode = (info.external_attr >> 16) & 0xFFFF
                kind = stat.S_IFMT(mode)
                if stat.S_ISLNK(mode) or (kind not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    fail("VSIX contains a link or special file")
                if info.flag_bits & 0x1:
                    fail("VSIX contains an encrypted entry")
                if info.is_dir():
                    if name not in ("extension", "extension/data", "extension/dist", "extension/docs"):
                        fail("VSIX contains an unexpected directory")
                    continue
                if not allowed_path(name):
                    fail("VSIX contains a file outside the reviewed extension inventory")
                if info.file_size < 1 or info.file_size > MAX_FILE_BYTES:
                    fail("VSIX contains an empty or oversized file")
                total += info.file_size
                if total > MAX_EXPANDED_BYTES:
                    fail("VSIX exceeds the expanded package budget")
                data = archive.read(info)
                if len(data) != info.file_size:
                    fail("VSIX entry size changed while reading")
                if nested_payload_signature(name, data):
                    fail("VSIX contains raw icon data or a nested archive")
                contents[name] = data
            if archive.testzip() is not None:
                fail("VSIX CRC validation failed")
    except (OSError, zipfile.BadZipFile, RuntimeError, ValueError) as error:
        if isinstance(error, ValueError) and str(error).startswith("VSIX "):
            raise
        fail("VSIX is invalid or unreadable")

    required = {
        "[Content_Types].xml",
        "extension.vsixmanifest",
        "extension/package.json",
        "extension/data/icons.json",
        "extension/dist/extension.js",
        "extension/dist/engine.js",
    }
    if require_package_set:
        required.add("extension/data/release-state.json")
    if not required.issubset(contents):
        fail("VSIX is missing a required extension or metadata file")
    try:
        index = json.loads(contents["extension/data/icons.json"])
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("VSIX icon index is not valid JSON")
    validate_icon_index(index, require_package_set=require_package_set)
    if require_package_set:
        try:
            package = json.loads(contents["extension/package.json"])
            state = json.loads(contents["extension/data/release-state.json"])
        except (UnicodeDecodeError, json.JSONDecodeError):
            fail("VSIX release metadata is not valid JSON")
        validate_release_binding(index, package, state)
    return len(contents), total, compressed_size


if __name__ == "__main__":
    args = sys.argv[1:]
    require_package_set = False
    if "--require-package-set" in args:
        require_package_set = True
        args.remove("--require-package-set")
    if len(args) != 1 or args[0].startswith("-"):
        print("usage: python3 scripts/verify-vsix-payload.py [--require-package-set] <extension.vsix>", file=sys.stderr)
        raise SystemExit(2)
    try:
        files, expanded, compressed = verify(args[0], require_package_set=require_package_set)
    except Exception as error:
        print(f"VSIX payload audit failed: {error}", file=sys.stderr)
        raise SystemExit(1)
    print(f"VSIX payload audit passed: {files} files, {expanded} expanded bytes, {compressed} compressed bytes")
