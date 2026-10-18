#!/usr/bin/env python3
"""Cut the site's UI assets out of tools/mockup.png.

Every button, border and panel on the site is a crop of the mockup. This
script is the single source of truth for those crops, so they can be
re-cut if the mockup changes.

    pip install numpy pillow opencv-python-headless
    python3 tools/extract_assets.py

Coordinates below are mockup pixels. The browser chrome ends at y=78, so
"design" coordinates used by the CSS are (x, y - 78).
"""
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "mockup.png"
UI = ROOT / "assets" / "ui"
NEWS = ROOT / "images" / "news"

PAGE_Y = 78          # first page row below the browser chrome
FOOTER_Y = 937       # footer strip starts here (mockup px)
PANEL = (397, 316, 1492, 935)            # news panel outer frame box
SLICE = dict(top=88, right=60, bottom=60, left=94)

img = np.asarray(Image.open(SRC).convert("RGB")).copy()
gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)


def save(arr, name, **kw):
    path = UI / name
    Image.fromarray(arr).save(path, **kw)
    print(f"  {path.relative_to(ROOT)}  {arr.shape[1]}x{arr.shape[0]}")


def rgba(rgb, alpha):
    return np.dstack([rgb, alpha.astype(np.uint8)])


def feather(mask, px=1.2):
    """0/1 mask -> soft 0..255 alpha."""
    m = Image.fromarray((mask > 0).astype(np.uint8) * 255)
    return np.asarray(m.filter(ImageFilter.GaussianBlur(px)))


def text_mask(box, thresh, grow=2):
    """Mask of bright text pixels inside box, grown so inpaint covers halos."""
    x0, y0, x1, y1 = box
    m = np.zeros(gray.shape, np.uint8)
    m[y0:y1, x0:x1] = (gray[y0:y1, x0:x1] > thresh).astype(np.uint8)
    return cv2.dilate(m, np.ones((2 * grow + 1, 2 * grow + 1), np.uint8))


def inpaint(arr, mask, radius=5):
    return cv2.inpaint(arr, mask * 255, radius, cv2.INPAINT_TELEA)


def inpaint_big(arr, box, scale=4):
    """Inpaint a large rectangle on a downscaled copy, then paste it back."""
    x0, y0, x1, y1 = box
    pad = 24
    X0, Y0, X1, Y1 = x0 - pad, y0 - pad, x1 + pad, y1 + pad
    sub = arr[Y0:Y1, X0:X1]
    small = cv2.resize(sub, (sub.shape[1] // scale, sub.shape[0] // scale), interpolation=cv2.INTER_AREA)
    m = np.zeros(small.shape[:2], np.uint8)
    m[pad // scale:(pad + y1 - y0) // scale, pad // scale:(pad + x1 - x0) // scale] = 255
    small = cv2.inpaint(small, m, 9, cv2.INPAINT_TELEA)
    up = cv2.resize(small, (sub.shape[1], sub.shape[0]), interpolation=cv2.INTER_CUBIC)
    out = arr.copy()
    out[y0:y1, x0:x1] = up[pad:pad + y1 - y0, pad:pad + x1 - x0]
    return out


def hull_mask(box, thresh=60):
    """Silhouette of a metal-rimmed button: convex hull of its bright rim."""
    x0, y0, x1, y1 = box
    m = (gray[y0:y1, x0:x1] > thresh).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    i = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])
    hull = cv2.convexHull(cv2.findNonZero((lab == i).astype(np.uint8)))
    out = np.zeros(m.shape, np.uint8)
    cv2.fillConvexPoly(out, hull, 1)
    return out


def ellipse_mask(shape, cx, cy, a, b):
    yy, xx = np.mgrid[:shape[0], :shape[1]]
    return (((xx - cx) / a) ** 2 + ((yy - cy) / b) ** 2) <= 1


def fit_ellipse_center(cx, cy, a, b, search=8):
    """Snap an ellipse outline to the brightest nearby ring."""
    t = np.linspace(0, 2 * np.pi, 360)
    best = None
    for dy in range(-search, search + 1):
        for dx in range(-search, search + 1):
            xs = (cx + dx + a * np.cos(t)).astype(int)
            ys = (cy + dy + b * np.sin(t)).astype(int)
            s = gray[ys, xs].astype(int).sum()
            if best is None or s > best[0]:
                best = (s, cx + dx, cy + dy)
    return best[1], best[2]


UI.mkdir(parents=True, exist_ok=True)
NEWS.mkdir(parents=True, exist_ok=True)
print("Cutting assets from", SRC.relative_to(ROOT))

# ---------------------------------------------------------------- nav buttons
# The bright silver rim survives thresholding on every button; its convex hull
# is the pill-with-diamond-tips silhouette. DOWNLOAD's orange rim breaks up on
# the right, so it borrows ABOUT's hull (same size, 88px lower).
NAV_X = (30, 395)
NAV = [("home", 403, 489), ("support", 489, 579), ("gallery", 578, 669),
       ("about", 667, 759), ("download", 757, 848)]
about_hull = None
nav_boxes = {}
for name, y0, y1 in NAV:
    box = (NAV_X[0], y0, NAV_X[1], y1)
    if name == "download":
        m = np.zeros((y1 - y0, NAV_X[1] - NAV_X[0]), np.uint8)
        ah, (ay0, _) = about_hull
        shift = 762 - 674
        dst = ay0 + shift - y0
        m[dst:dst + ah.shape[0]] = ah[:m.shape[0] - dst]
    else:
        m = hull_mask(box)
    if name == "about":
        ys = np.nonzero(m.any(1))[0]
        about_hull = (m[ys[0]:ys[-1] + 1], (y0 + ys[0], y0 + ys[-1]))
    ys, xs = np.nonzero(m)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = img[y0 + by0:y0 + by1, NAV_X[0] + bx0:NAV_X[0] + bx1]
    save(rgba(crop, feather(m[by0:by1, bx0:bx1], 0.8)), f"nav-{name}.png")
    nav_boxes[name] = tuple(int(v) for v in (NAV_X[0] + bx0, y0 + by0 - PAGE_Y, bx1 - bx0, by1 - by0))

# ------------------------------------------------------------ news panel frame
# 9-slice panel frame. Corners come straight from the mockup (with the
# heading star and the "View all news" button painted out); edges are a single
# clean row/column of the mockup repeated, so they stretch without artefacts.
px0, py0, px1, py1 = PANEL
T, Rr, B, Lf = SLICE["top"], SLICE["right"], SLICE["bottom"], SLICE["left"]
MID = 8
panel = img[py0:py1, px0:px1].copy().astype(np.float32)
pw, ph = px1 - px0, py1 - py0
interior = np.median(panel[ph // 2 - 40:ph // 2 + 40, pw - Rr - 40:pw - Rr - 4].reshape(-1, 3), 0)
panel[326 - py0:398 - py0, 452 - px0:Lf] = interior            # heading star (TL)
panel[336 - py0:394 - py0, pw - Rr:1454 - px0] = interior      # view-all button (TR)
W, H = Lf + MID + Rr, T + MID + B
frame = np.zeros((H, W, 3), np.float32)
frame[:T, :Lf] = panel[:T, :Lf]
frame[:T, Lf + MID:] = panel[:T, pw - Rr:]
frame[T + MID:, :Lf] = panel[ph - B:, :Lf]
frame[T + MID:, Lf + MID:] = panel[ph - B:, pw - Rr:]
frame[:T, Lf:Lf + MID] = panel[:T, 1150 - px0][:, None]               # top edge
frame[T + MID:, Lf:Lf + MID] = panel[ph - B:, 1350 - px0][:, None]   # bottom edge
frame[T:T + MID, :Lf] = panel[620 - py0, :Lf][None]                   # left edge
frame[T:T + MID, Lf + MID:] = panel[620 - py0, pw - Rr:][None]       # right edge
frame[T:T + MID, Lf:Lf + MID] = interior
# The mockup's interior has a soft vignette that differs between corners and
# edges; flatten the dark pixels to one colour so the slices meet seamlessly.
lum = frame.mean(2, keepdims=True)
keep = np.clip((lum - 22) / 28, 0, 1)
frame = (keep * frame + (1 - keep) * interior).round().astype(np.uint8)
# Chamfered outer corners: let the page show through.
yy, xx = np.mgrid[:H, :W]
CH = 5
cut = (xx + yy < CH) | ((W - 1 - xx) + yy < CH) | (xx + (H - 1 - yy) < CH) | ((W - 1 - xx) + (H - 1 - yy) < CH)
frame = rgba(frame, np.where(cut, 0, 255))
# Saved as eight pieces for CSS multiple backgrounds (Firefox mis-renders
# border-image inside a zoomed element).
(UI / "panel").mkdir(exist_ok=True)
X = [0, Lf, Lf + MID, W]
Y = [0, T, T + MID, H]
names = [["tl", "t", "tr"], ["l", None, "r"], ["bl", "b", "br"]]
for r in range(3):
    for c in range(3):
        if names[r][c]:
            save(frame[Y[r]:Y[r + 1], X[c]:X[c + 1]], f"panel/{names[r][c]}.png")
print("  panel interior colour", "#%02x%02x%02x" % tuple(int(v) for v in interior))

# Timeline node (blue glowing dot) with a soft round edge.
dcx, dcy, dr = 461, 450, 21
dot = img[dcy - dr:dcy + dr + 1, dcx - dr:dcx + dr + 1]
yy, xx = np.mgrid[-dr:dr + 1, -dr:dr + 1]
dist = np.sqrt(xx ** 2 + yy ** 2)
save(rgba(dot, np.clip((dr - dist) / 6, 0, 1) * 255), "timeline-dot.png")

# Heading star.
star = img[328:394, 456:521]
yy, xx = np.mgrid[:star.shape[0], :star.shape[1]]
d = np.sqrt((xx - 32.5) ** 2 + (yy - 32) ** 2)
save(rgba(star, np.clip((33 - d) / 8, 0, 1) * 255), "star.png")

# ------------------------------------------------------ thumbnail ring + thumbs
A, Bax = 71, 58                      # outer ellipse semi-axes
RING_IN = 6                          # ring thickness
centres = []
for cy in (460, 585, 710, 830):
    centres.append(fit_ellipse_center(661, cy, A - 2, Bax - 2))
print("  thumb centres", centres)
cx, cy = centres[0]
pad = 4
rx0, ry0 = cx - A - pad, cy - Bax - pad
ring = img[ry0:cy + Bax + pad + 1, rx0:cx + A + pad + 1]
sh = ring.shape[:2]
outer = ellipse_mask(sh, A + pad, Bax + pad, A + 1, Bax + 1)
inner = ellipse_mask(sh, A + pad, Bax + pad, A - RING_IN, Bax - RING_IN)
save(rgba(ring, feather(outer & ~inner, 0.7)), "thumb-ring.png")
for i, (cx, cy) in enumerate(centres, 1):
    a, b = A - 3, Bax - 3
    th = img[cy - b:cy + b + 1, cx - a:cx + a + 1]
    Image.fromarray(th).save(NEWS / f"mockup-{i}.jpg", quality=92)
    print(f"  images/news/mockup-{i}.jpg")

# ------------------------------------------------------------------ background
# Fixed hero layer: everything above the footer, with the parts the site draws
# live (tagline, build badge text, the news panel) painted out.
bg = img.copy()
bg = inpaint(bg, text_mask((515, 260, 1200, 287), 40, 2), 5)          # tagline
bg = inpaint(bg, text_mask((1385, 105, 1640, 150), 45, 2), 5)        # badge text
bg = inpaint_big(bg, (px0 - 2, py0 - 2, px1 + 2, py1 + 2))            # news panel
bg = bg[PAGE_Y:FOOTER_Y]
Image.fromarray(bg).save(UI / "bg.jpg", quality=90)
print(f"  assets/ui/bg.jpg  {bg.shape[1]}x{bg.shape[0]}")

# ----------------------------------------------------------------------- footer
# Opaque fixed strip. Status ring/text and the copyright line are live HTML.
ft = img.copy()
# The ring and its glow fill the panel's height, so any 2D inpaint drags the
# glow in from above/below. Interpolate each row between the clean columns on
# either side instead.
RX0, RX1 = 46, 208
t = np.linspace(0, 1, RX1 - RX0)[None, :, None]
rows = slice(953, 1079)
left = ft[rows, RX0 - 3:RX0].mean(1, keepdims=True)
right = ft[rows, RX1:RX1 + 3].mean(1, keepdims=True)
ft[rows, RX0:RX1] = ((1 - t) * left + t * right).round().astype(np.uint8)
ft = inpaint(ft, text_mask((205, 958, 470, 1052), 70, 2), 5)        # status text
ft = inpaint(ft, text_mask((210, 1110, 815, 1140), 45, 2), 5)       # © line (left half)
ft = ft[FOOTER_Y:]
Image.fromarray(ft).save(UI / "footer.jpg", quality=92)
print(f"  assets/ui/footer.jpg  {ft.shape[1]}x{ft.shape[0]}")

# Community hub icons (circle crops so the hover glow follows the badge).
HUB = [("discord", 1285), ("forums", 1389), ("wiki", 1492), ("socials", 1597)]
hub_boxes = {}
for name, hx in HUB:
    hx, hy = fit_ellipse_center(hx, 1021, 36, 36, 4)
    r = 39
    c = img[hy - r:hy + r + 1, hx - r:hx + r + 1]
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    d = np.sqrt(xx ** 2 + yy ** 2)
    save(rgba(c, np.clip((r - d) / 1.5, 0, 1) * 255), f"hub-{name}.png")
    hub_boxes[name] = (hx - r, hy - r - FOOTER_Y)

# ------------------------------------------------------------- misc / branding
logo = img[92:198, 48:158]
Image.fromarray(logo).resize((64, 62), Image.LANCZOS).save(ROOT / "favicon.png")
print("  favicon.png")
title = img[80:258, 585:1140]
Image.fromarray(title).save(UI / "title.jpg", quality=90)
print("  assets/ui/title.jpg")
Image.fromarray(img[PAGE_Y:]).resize((1200, 753), Image.LANCZOS).save(ROOT / "og-image.jpg", quality=85)
print("  og-image.jpg")

print("\nDesign coordinates (x, y, w, h):")
for k, v in nav_boxes.items():
    print(f"  nav-{k}: {v}")
for k, v in hub_boxes.items():
    print(f"  hub-{k}: left {v[0]} top {v[1]} (footer-relative)")
