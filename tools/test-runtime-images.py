#!/usr/bin/env python3
"""Check runtime exports after source images are removed or renamed."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from PIL import Image

with TemporaryDirectory(prefix='mixxtopia-image-export-') as directory:
    repo = Path(directory)
    (repo / 'tools').mkdir()
    (repo / 'js').mkdir()
    source = repo / 'assets/scenes'
    source.mkdir(parents=True)
    script = repo / 'tools/build-runtime-images.py'
    shutil.copyfile(Path(__file__).with_name(script.name), script)
    for name in ['removed', 'renamed']:
        Image.new('RGBA', (12, 8), (30, 90, 180, 128)).save(source / f'{name}.webp', lossless=True)
    Image.new('RGB', (1327, 1185), (180, 130, 75)).save(source / 'backstage-room-test.webp', lossless=True)
    subprocess.run([sys.executable, script], check=True, capture_output=True)
    output = repo / 'assets/runtime'
    note = output / 'keep.txt'
    note.write_text('export notes\n')
    (source / 'removed.webp').unlink()
    (source / 'renamed.webp').rename(source / 'current.webp')
    subprocess.run([sys.executable, script], check=True, capture_output=True)
    manifest = json.loads((output / 'manifest.json').read_text())
    assert set(manifest) == {'assets/scenes/current.webp', 'assets/scenes/backstage-room-test.webp'}
    assert {p.relative_to(output).as_posix() for p in output.rglob('*.webp')} == {'scenes/current.webp', 'scenes/backstage-room-test.webp'}
    with Image.open(output / 'scenes/backstage-room-test.webp') as image:
        assert image.size == (1327, 1185), 'Whole backstage room keeps the three-times detail resolution'
    assert note.read_text() == 'export notes\n'
    with Image.open(output / 'scenes/current.webp') as image:
        assert image.size == (12, 8)
        assert image.getpixel((0, 0)) == (30, 90, 180, 128)
    mapping = (repo / 'js/runtime-images.js').read_text()
    assert 'current.webp' in mapping and 'removed.webp' not in mapping and 'renamed.webp' not in mapping
print('Passed: removed / renamed sources leave no stale runtime WebP; manifest, alpha and notes preserved.')
