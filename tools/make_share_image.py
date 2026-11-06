#!/usr/bin/env python3
"""The link preview image (assets/share.jpg, 1200x630, the og:image in index.html): an in-game shot, darkened towards
the bottom, with the title and the tagline over it. Run again to change the shot (SHOT).

    pip install pillow
    python3 tools/make_share_image.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOT = ROOT / "images" / "wiki" / "systems" / "new-york-planet.webp"
OUT = ROOT / "assets" / "share.jpg"
W, H = 1200, 630
TAGLINE = "THE 2003 CLASSIC, FULLY REMADE"


def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def main():
    img = cover(Image.open(SHOT).convert("RGB"), W, H).convert("RGBA")
    # darken from the middle down, where the title sits
    shade = Image.new("L", (1, H))
    for y in range(H):
        t = max(0.0, (y / H - 0.35) / 0.65)
        shade.putpixel((0, y), int(40 + 175 * t ** 1.2))
    dark = Image.new("RGBA", (W, H), (2, 5, 11, 255))
    dark.putalpha(shade.resize((W, H)))
    img.alpha_composite(dark)

    title = Image.open(ROOT / "assets" / "ui" / "title.webp").convert("RGBA")
    tw = 620
    title = title.resize((tw, round(title.height * tw / title.width)), Image.LANCZOS)
    tx, ty = (W - tw) // 2, H - title.height - 92
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    glow.alpha_composite(title, (tx, ty))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.putalpha(glow.getchannel("A").filter(ImageFilter.GaussianBlur(14)).point(lambda v: v * 0.8))
    img.alpha_composite(shadow)
    img.alpha_composite(title, (tx, ty))

    font = ImageFont.truetype(str(ROOT / "tools" / "fonts" / "Barlow-Medium.ttf"), 30)
    d = ImageDraw.Draw(img)
    spaced = " ".join(TAGLINE).replace("   ", "     ")
    l, t, r, b = d.textbbox((0, 0), spaced, font=font)
    d.text(((W - (r - l)) // 2, H - 72), spaced, font=font, fill=(220, 228, 238, 255))
    img.convert("RGB").save(OUT, quality=88, optimize=True, progressive=True)
    print(f"  {OUT.name}  {W}x{H}")


if __name__ == "__main__":
    main()
