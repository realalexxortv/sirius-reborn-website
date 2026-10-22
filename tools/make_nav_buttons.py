#!/usr/bin/env python3
"""Nav buttons the mockup does not have (Donate, How?), made from the cut ones.

Takes a button from tools/extract_assets.py, paints its icon and label out of
the pill, optionally turns the pill to another hue, and draws a new icon and a
new label in Cinzel (tools/fonts, the site's heading font, OFL).

    pip install numpy pillow
    python3 tools/make_nav_buttons.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
UI = ROOT / "assets" / "ui"
FONT = ROOT / "tools" / "fonts" / "Cinzel.ttf"

PILL = (52, 17, 262, 68)     # the pill's inside, around the icon and label
ICON_C = (86, 42)            # icon centre
LABEL_X = 136                # label's left edge
LABEL_CY = 44                # label's vertical centre (cap height)
SS = 4                       # supersampling for the drawn art


def blur(a, sigma):
    """Separable Gaussian blur of a float array (H, W)."""
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    a = np.pad(a, r, mode="edge")
    a = np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 1, a)
    return np.apply_along_axis(lambda v: np.convolve(v, k, "valid"), 0, a)


def erase(rgba):
    """Paint the icon and label out: fill their pixels from the smooth pill around them."""
    a = np.asarray(rgba).astype(np.float32)
    rgb, alpha = a[..., :3], a[..., 3:]
    x0, y0, x1, y1 = PILL
    lum = rgb.max(2)
    mask = np.zeros(lum.shape, bool)
    mask[y0:y1, x0:x1] = lum[y0:y1, x0:x1] > 75
    m = Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))
    mask = np.asarray(m) > 0
    keep = (~mask).astype(np.float32)
    out = rgb.copy()
    # normalised blur: the average of the kept pixels nearby; small first, wider where a glyph is too big for it
    done = np.zeros(mask.shape, bool)
    for r in (3, 6, 12):
        den = blur(keep, r)
        fill = np.dstack([blur(rgb[..., c] * keep, r) for c in range(3)]) / np.maximum(den, 1e-4)[..., None]
        ok = mask & ~done & (den > 0.15 if r < 12 else den > 0)
        out[ok] = fill[ok]
        done |= ok
    return Image.fromarray(np.dstack([out, alpha]).clip(0, 255).astype(np.uint8), "RGBA")


def rehue(rgba, hue_deg, sat=1.0):
    """Turn the coloured pill to another hue; the grey rim and the blue side gems stay."""
    hsv = np.asarray(rgba.convert("RGB").convert("HSV")).astype(np.float32)
    a = np.asarray(rgba)[..., 3]
    x0, y0, x1, y1 = PILL
    m = np.zeros(a.shape, np.float32)
    m[y0 - 8:y1 + 8, x0 - 12:x1 + 36] = 1
    m = blur(m, 3)
    m *= np.clip((hsv[..., 1] - 40) / 60, 0, 1)
    h = hsv.copy()
    h[..., 0] = hue_deg / 360 * 255
    h[..., 1] = np.clip(hsv[..., 1] * sat, 0, 255)
    out = hsv * (1 - m[..., None]) + h * m[..., None]
    rgb = Image.fromarray(out.astype(np.uint8), "HSV").convert("RGB")
    return Image.merge("RGBA", (*rgb.split(), Image.fromarray(a)))


def glow_layer(shape_l, colour, radius, strength):
    g = shape_l.filter(ImageFilter.GaussianBlur(radius))
    g = g.point(lambda v: min(255, int(v * strength)))
    layer = Image.new("RGBA", shape_l.size, colour + (0,))
    layer.putalpha(g)
    return layer


def paint(shape_l, top, bottom):
    """A white-ish vertical gradient (like the mockup's icons and labels) in a shape."""
    w, h = shape_l.size
    grad = np.linspace(0, 1, h)[:, None, None]
    col = (np.array(top)[None, None] * (1 - grad) + np.array(bottom)[None, None] * grad)
    img = Image.fromarray(np.repeat(col, w, 1).astype(np.uint8), "RGB").convert("RGBA")
    img.putalpha(shape_l)
    return img


def heart(size):
    s = size * SS
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    r = s * 0.26
    cy = s * 0.36
    d.ellipse((s * 0.5 - 2 * r + s * 0.02, cy - r, s * 0.5 + s * 0.02, cy + r), fill=255)
    d.ellipse((s * 0.5 - s * 0.02, cy - r, s * 0.5 + 2 * r - s * 0.02, cy + r), fill=255)
    d.polygon([(s * 0.5 - 2 * r + s * 0.05, cy + r * 0.45), (s * 0.5 + 2 * r - s * 0.05, cy + r * 0.45), (s * 0.5, s * 0.92)], fill=255)
    return m


def cog(size, teeth=8):
    s = size * SS
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    c = s / 2
    ro, ri = s * 0.47, s * 0.36
    pts = []
    for i in range(teeth * 4):
        ang = (i / (teeth * 4)) * 2 * np.pi
        rad = ro if (i % 4) in (1, 2) else ri
        pts.append((c + rad * np.cos(ang), c + rad * np.sin(ang)))
    d.polygon(pts, fill=255)
    d.ellipse((c - ri * 0.98, c - ri * 0.98, c + ri * 0.98, c + ri * 0.98), fill=255)
    hole = s * 0.15
    d.ellipse((c - hole, c - hole, c + hole, c + hole), fill=0)
    return m


def label(text, px):
    """Cinzel Bold; its lower case is small caps, like the mockup's labels."""
    font = ImageFont.truetype(str(FONT), px * SS)
    font.set_variation_by_name("Bold")
    l, t, r, b = font.getbbox(text)
    m = Image.new("L", (r - l + 8 * SS, b - t + 8 * SS), 0)
    ImageDraw.Draw(m).text((4 * SS - l, 4 * SS - t), text, font=font, fill=255)
    cap = font.getbbox("H")
    return m, (cap[3] - cap[1]) / SS


def down(m):
    return m.resize((m.width // SS, m.height // SS), Image.LANCZOS)


def make(base, out, text, icon, glow, hue=None, sat=1.0):
    btn = erase(Image.open(UI / base).convert("RGBA"))
    if hue is not None:
        btn = rehue(btn, hue, sat)
    art = Image.new("RGBA", btn.size, (0, 0, 0, 0))
    # icon
    ic = down(icon)
    pos = (ICON_C[0] - ic.width // 2, ICON_C[1] - ic.height // 2)
    full = Image.new("L", btn.size, 0)
    full.paste(ic, pos)
    art.alpha_composite(glow_layer(full, glow, 4, 1.4))
    art.alpha_composite(paint(full, (236, 244, 255), (176, 206, 240)))
    # label: drop shadow, soft glow, silver gradient
    lm, cap = label(text, 31)
    lm = down(lm)
    lab = Image.new("L", btn.size, 0)
    lab.paste(lm, (LABEL_X - 4, round(LABEL_CY - 4 - cap / 2)))
    shadow = Image.new("RGBA", btn.size, (0, 0, 0, 0))
    shadow.putalpha(ImageChops.offset(lab, 1, 2).filter(ImageFilter.GaussianBlur(1.2)).point(lambda v: v * 0.8))
    art.alpha_composite(shadow)
    art.alpha_composite(glow_layer(lab, glow, 3, 0.6))
    art.alpha_composite(paint(lab, (246, 247, 250), (196, 204, 218)))
    btn.alpha_composite(art)
    btn.save(UI / out)
    print(f"  assets/ui/{out}  {btn.width}x{btn.height}")


if __name__ == "__main__":
    make("nav-support.png", "nav-donate.png", "Donate", heart(40), (190, 140, 255))
    make("nav-home.png", "nav-how.png", "How?", cog(44), (110, 240, 170), hue=145, sat=0.7)
