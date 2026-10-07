"""Bounded private artifact extraction. Retain only catalog/asset manifests/barrels."""
import hashlib
import json
import os
import re
import stat
import sys
import tarfile
import unicodedata
import zipfile
from pathlib import Path


def safe(name):
    if name.startswith('./'):
        name = name[2:]
    assert name and not name.startswith('/') and '\\' not in name and name == unicodedata.normalize('NFC', name), 'unsafe archive path'
    assert all(part not in ('', '.', '..') for part in name.rstrip('/').split('/')), 'unsafe archive path'
    return name.rstrip('/')


def digest(stream):
    result = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        result.update(block)
    return result.hexdigest()


def main():
    root = Path(sys.argv[2])
    with zipfile.ZipFile(sys.argv[1]) as archive:
        members = archive.infolist()
        assert len(members) <= 512 and sum(item.file_size for item in members) <= 2 * 1024 ** 3, 'ZIP budget exceeded'
        seen = set()
        for item in members:
            name = safe(item.filename)
            assert name.casefold() not in seen and not item.flag_bits & 1 and not stat.S_ISLNK(item.external_attr >> 16), 'unsafe/duplicate ZIP entry'
            seen.add(name.casefold())
        assert archive.getinfo('release-descriptor.json').file_size <= 8 * 1024 ** 2, 'descriptor too large'
        descriptor_bytes = archive.read('release-descriptor.json')
        assert len(descriptor_bytes) <= 8 * 1024 ** 2, 'descriptor too large'
        assert hashlib.sha256(descriptor_bytes).hexdigest() == os.environ['DESCRIPTOR_SHA256'], 'descriptor SHA mismatch'
        descriptor = json.loads(descriptor_bytes)
        assert descriptor['fullVersion'] == os.environ['RESOURCE_VERSION'] and descriptor['sourceCommit'] == os.environ['SOURCE_COMMIT'] and descriptor['generatorCommit'] == os.environ['GENERATOR_COMMIT'], 'descriptor identity mismatch'
        for tier in ('free', 'pro'):
            ref = descriptor[tier]
            assert ref['filename'] == f"moe-icons-{tier}-{descriptor['fullVersion']}.tgz", 'tier archive name mismatch'
            item = archive.getinfo(ref['filename'])
            assert item.file_size == ref['size'] and item.file_size <= 256 * 1024 ** 2, 'tier compressed budget/size mismatch'
            with archive.open(item) as stream:
                assert digest(stream) == ref['sha256'], 'tier archive SHA mismatch'
            paths = set()
            expanded = 0
            with archive.open(item) as stream, tarfile.open(fileobj=stream, mode='r|gz') as tar:
                for entry in tar:
                    name = safe(entry.name)
                    assert name.casefold() not in paths and len(paths) < 100000, 'duplicate/too many tar entries'
                    paths.add(name.casefold())
                    assert entry.isfile() or entry.isdir(), 'non-regular tar entry'
                    assert entry.size <= 32 * 1024 ** 2, 'tar member budget exceeded'
                    expanded += entry.size
                    assert expanded <= 1024 ** 3, 'tar expansion budget exceeded'
                    keep = name in ('catalog.json', 'assets/manifest.json') or re.fullmatch(r'(react|vue|vanilla)/moe-[a-z0-9-]+/index\.d\.ts', name)
                    if entry.isfile() and keep:
                        output = root / tier / name
                        output.parent.mkdir(parents=True, exist_ok=True)
                        content = tar.extractfile(entry).read()
                        output.write_bytes(content)
        (root / 'release-descriptor.json').write_bytes(descriptor_bytes)


if __name__ == '__main__':
    main()
