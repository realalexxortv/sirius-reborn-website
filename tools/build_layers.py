#!/usr/bin/env python3
"""Build the free-floating layers: character cutouts, title, and the nebula.

The characters (Trent and Juni, from the renders in tools/trent.png and
tools/juni.jpg) and the title (from the mockup) are cut out of their
backgrounds with segmentation models (rembg); the characters are then
colour graded to sit on the nebula. The page background is
NASA/ESA/CSA/STScI's Webb "Cosmic Cliffs" image (public domain), rotated a
quarter turn so its blue side sits behind Trent and the orange side behind
Juni, as in the mockup.

    pip install numpy pillow opencv-python-headless "rembg[cpu]"
    python3 tools/build_layers.py                # everything
    python3 tools/build_layers.py characters     # or any of: characters title nebula

The first run downloads the models (~180 MB and ~900 MB) and the nebula.
"""
import io
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "mockup.png"
UI = ROOT / "assets" / "ui"
NEBULA_URL = ("https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/"
              "NASA%E2%80%99s_Webb_Reveals_Cosmic_Cliffs%2C_Glittering_Landscape_of_Star_Birth.jpg/"
              "3840px-NASA%E2%80%99s_Webb_Reveals_Cosmic_Cliffs%2C_Glittering_Landscape_of_Star_Birth.jpg")

mockup = Image.open(SRC).convert("RGB")


def largest_component(alpha, keep_above=0.5):
    """Zero out everything but the biggest blob (drops stray specks)."""
    m = (alpha > keep_above * 255).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n <= 1:
        return alpha
    i = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    keep = cv2.dilate((lab == i).astype(np.uint8), np.ones((9, 9), np.uint8))
    return (alpha * keep).astype(np.uint8)


def fade_bottom(alpha, start, end):
    """Linear fade to transparent between rows start..end."""
    h = alpha.shape[0]
    ramp = np.clip((end - np.arange(h)) / max(1, end - start), 0, 1)[:, None]
    return (alpha * ramp).astype(np.uint8)


def cutout(box, model, post=None):
    crop = mockup.crop(box)
    out = np.asarray(remove(crop, session=new_session(model), post_process_mask=True)).copy()
    a = out[..., 3]
    if post:
        a = post(a)
    out[..., 3] = a
    ys, xs = np.nonzero(a > 4)
    return Image.fromarray(out[ys.min():ys.max() + 1, xs.min():xs.max() + 1])


def save(im, name, **kw):
    path = UI / name
    im.save(path, **kw)
    print(f"  {path.relative_to(ROOT)}  {im.width}x{im.height}  {path.stat().st_size // 1024} KB")


def grade(rgb, alpha, gamma, gain, shadow_tint, rim_color, rim_side, rim_strength):
    """Match a render's lighting to the nebula behind it.

    gamma/gain set brightness, shadow_tint pushes the darks toward the
    nebula's colour, and a rim light is added along the silhouette edges
    facing rim_side (-1 = left, +1 = right).
    """
    x = rgb.astype(np.float32) / 255
    x = np.clip(gain * x ** gamma, 0, 1)
    lum = x @ np.float32([0.299, 0.587, 0.114])
    x += (1 - lum)[..., None] ** 2 * np.float32(shadow_tint)

    a = alpha.astype(np.float32) / 255
    w = alpha.shape[1]
    r = max(3, round(w * 0.008))
    inner = cv2.GaussianBlur(a, (0, 0), r)
    edge = np.clip(a - inner, 0, 1) * a
    edge = cv2.GaussianBlur(edge, (0, 0), r / 2)
    side = np.clip(0.5 + rim_side * (np.arange(w) / w - 0.5) * 2.4, 0, 1)[None, :]
    x += (edge * side * rim_strength)[..., None] * np.float32(rim_color)
    return (np.clip(x, 0, 1) * 255).astype(np.uint8)


def character(src, box, model, post, **look):
    """Cut a character render out of its own background, crop and grade it."""
    im = Image.open(src).convert("RGB")
    out = np.asarray(remove(im, session=new_session(model), post_process_mask=True)).copy()
    out = out[box[1]:box[3], box[0]:box[2]].copy()
    a = post(largest_component(out[..., 3]))
    out[..., :3] = grade(out[..., :3], a, **look)
    out[..., 3] = a
    ys, xs = np.nonzero(a > 4)
    return Image.fromarray(out[ys.min():ys.max() + 1, xs.min():xs.max() + 1])


def fit_height(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


only = set(sys.argv[1:]) or {"characters", "title", "nebula"}

if "characters" in only:
    print("Cutting characters from tools/trent.png and tools/juni.jpg")

    # Trent, left (blue side): head to waist, fading out behind the nav. His
    # render is a dark night shot, so the shadows are lifted and cooled.
    trent = character(ROOT / "tools" / "trent.png", (600, 0, 1240, 860), "birefnet-portrait",
                      lambda a: fade_bottom(a, a.shape[0] - 300, a.shape[0] - 20),
                      gamma=0.72, gain=1.12, shadow_tint=(0.0, 0.018, 0.06),
                      rim_color=(0.45, 0.7, 1.0), rim_side=-1, rim_strength=1.6)
    save(fit_height(trent, 880), "char-man.webp", quality=90, method=6)

    # Juni, right (orange side): down to the hips, then fade. Her render is lit
    # by flat daylight, so she's darkened, warmed and given an orange rim.
    juni = character(ROOT / "tools" / "juni.jpg", (0, 0, 1264, 1290), "birefnet-portrait",
                     lambda a: fade_bottom(a, 1010, 1270),
                     gamma=1.12, gain=0.88, shadow_tint=(0.02, 0.006, -0.008),
                     rim_color=(1.0, 0.55, 0.2), rim_side=1, rim_strength=0.8)
    save(juni, "char-lady.webp", quality=90, method=6)

if "title" in only:
    print("Cutting the title from", SRC.relative_to(ROOT))
    save(cutout((585, 80, 1140, 258), "isnet-general-use"), "title.webp", quality=92, method=6)

# --------------------------------------------------------------- nebula
if "nebula" not in only:
    sys.exit()
print("Downloading nebula")
req = urllib.request.Request(NEBULA_URL, headers={"User-Agent": "sirius-reborn-site-build/1.0"})
neb = Image.open(io.BytesIO(urllib.request.urlopen(req).read())).convert("RGB")
neb = neb.rotate(90, expand=True)                    # blue left, orange right
w, h = neb.size
band = round(w * 9 / 16)
top = round(h * 0.45 - band / 2)
neb = neb.crop((0, top, w, top + band))
save(neb, "nebula.jpg", quality=80, optimize=True, progressive=True)
