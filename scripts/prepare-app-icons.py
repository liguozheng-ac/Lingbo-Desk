"""Encode the supplied artwork as square PNG and multi-size Windows ICO assets.

Only scaling/padding and format conversion are performed; the artwork is unchanged.
Requires Pillow (included in requirements-windows.lock).
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageOps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "desktop/apps/stage-tamagotchi/resources")
    args = parser.parse_args()
    source = args.source.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as raw:
        original = ImageOps.exif_transpose(raw).convert("RGBA")
        canvas = Image.new("RGBA", (512, 512), "white")
        fitted = ImageOps.contain(original, (480, 480), Image.Resampling.LANCZOS)
        canvas.alpha_composite(fitted, ((512 - fitted.width) // 2, (512 - fitted.height) // 2))
        for name in ("icon.png", "icon-512.png"):
            canvas.save(args.output / name)
        canvas.save(args.output / "icon.ico", sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
    print(json.dumps({"sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "sourceSize": original.size, "pngSize": canvas.size, "icoSizes": [16, 24, 32, 48, 64, 128, 256], "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
