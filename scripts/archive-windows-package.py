"""Archive only a verified candidate; never collect adjacent smoke workspaces."""
import json
import sys
import zipfile
from pathlib import Path

root, destination = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
if not (root / 'LingboDesk.exe').is_file() or not (root / 'resources/package-manifest.json').is_file():
    raise ValueError('Not a packaged candidate')
if destination.exists() or destination.parent != root.parent:
    raise ValueError('Use a new adjacent ZIP path')
files = sorted(p for p in root.rglob('*') if p.is_file())
if any(p.is_symlink() for p in root.rglob('*')):
    raise ValueError('Archive input contains links')
with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as archive:
    for item in files:
        archive.write(item, root.name + '/' + item.relative_to(root).as_posix())
with zipfile.ZipFile(destination) as archive:
    if len(archive.infolist()) != len(files) or archive.testzip() is not None:
        raise ValueError('ZIP integrity check failed')
print(json.dumps({'passed': True, 'files': len(files), 'archiveBytes': destination.stat().st_size, 'crcVerified': True}))
