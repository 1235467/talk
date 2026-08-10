#!/usr/bin/env python3
"""Cross-platform port of sync-android-icon.ps1.

Resizes public/app-icon.png into the launcher mipmaps of the generated
android/ project (local checkout or CI, right after `cap add android`).
Requires Pillow: python3 -m pip install pillow
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "app-icon.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

LAUNCHER_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

FOREGROUND_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

BACKGROUND_XML = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<resources>\n"
    '    <color name="ic_launcher_background">#DDF7EF</color>\n'
    "</resources>\n"
)


def save_resized(img: Image.Image, dest: Path, size: int) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(dest, "PNG")


def main() -> None:
    if not SRC.exists():
        raise SystemExit(f"Missing app icon source: {SRC}")
    if not RES.exists():
        raise SystemExit(f"Missing generated android project: {RES} (run `npx cap add android` first)")
    img = Image.open(SRC).convert("RGBA")

    for folder, size in LAUNCHER_SIZES.items():
        save_resized(img, RES / folder / "ic_launcher.png", size)
        save_resized(img, RES / folder / "ic_launcher_round.png", size)
    for folder, size in FOREGROUND_SIZES.items():
        save_resized(img, RES / folder / "ic_launcher_foreground.png", size)

    values = RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(BACKGROUND_XML, encoding="utf-8")

    print(f"[sync-android-icon] launcher icons updated in {RES}")


if __name__ == "__main__":
    main()
