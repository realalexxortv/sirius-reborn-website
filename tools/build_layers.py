#!/usr/bin/env python3
"""Build the free-floating layers: character cutouts, title, and the nebula.

The characters and the title are painted onto the mockup's own background,
so they're cut out with segmentation models (rembg). The page background is
NASA/ESA/CSA/STScI's Webb "Cosmic Cliffs" image (public domain), rotated a
quarter turn so its blue side sits behind the man and the orange side
behind the woman, as in the mockup.

    pip install numpy pillow opencv-python-headless "rembg[cpu]"
    python3 tools/build_layers.py

The first run downloads the models (~180 MB and ~900 MB) and the nebula.
"""
import io
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


print("Cutting layers from", SRC.relative_to(ROOT))

# The man: head and shoulders only (the nav buttons cover the rest of him in
# the mockup). The Freelancer logo in the corner of the crop is dropped.
def man_post(a):
    a = a.copy()
    a[:140, :150] = 0
    a = largest_component(a)
    return fade_bottom(a, a.shape[0] - 90, a.shape[0])

save(cutout((25, 85, 400, 402), "isnet-general-use", man_post), "char-man.webp", quality=90, method=6)

# The woman: down to the hips, then fade, as she dissolves into fire in the mockup.
def lady_post(a):
    a = largest_component(a)
    return fade_bottom(a, 400, 545)

save(cutout((1440, 150, 1712, 945), "birefnet-portrait", lady_post), "char-lady.webp", quality=90, method=6)

save(cutout((585, 80, 1140, 258), "isnet-general-use"), "title.webp", quality=92, method=6)

# --------------------------------------------------------------- nebula
print("Downloading nebula")
req = urllib.request.Request(NEBULA_URL, headers={"User-Agent": "sirius-reborn-site-build/1.0"})
neb = Image.open(io.BytesIO(urllib.request.urlopen(req).read())).convert("RGB")
neb = neb.rotate(90, expand=True)                    # blue left, orange right
w, h = neb.size
band = round(w * 9 / 16)
top = round(h * 0.45 - band / 2)
neb = neb.crop((0, top, w, top + band))
save(neb, "nebula.jpg", quality=80, optimize=True, progressive=True)
