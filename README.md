# Sirius Reborn website

The website for **Sirius Reborn**, the 2003 classic fully remade in Unreal Engine.

It's a static site (plain HTML/CSS/JS, no build step) that runs on GitHub Pages and comes with a small browser-based CMS for the news timeline and pages.

- **Site:** `index.html`
- **CMS:** `admin/` (open `/admin/` on the live site)

## How it's put together

| Path | What it is |
|---|---|
| `index.html`, `css/site.css`, `js/site.js` | The site. A hash router renders the news timeline, single posts and the four pages inside the main panel. |
| `js/content.js` | Markdown rendering, date formatting and front matter helpers, shared by the site and the CMS. |
| `content/news.json` | All news posts: title, date, tag, timeline image, excerpt and the full Markdown body. |
| `content/pages/*.md` | Support, Gallery, About and Download pages (Markdown with a `title` / `subtitle` header). |
| `content/settings.json` | Tagline, build badge, project status ring, Community Hub links, footer text. |
| `assets/ui/` | Every button, frame and panel, cropped straight from the mockup, plus the character cutouts and the nebula. |
| `tools/extract_assets.py` | Crops the buttons, frames and panels from `tools/mockup.png`. |
| `tools/build_layers.py` | Cuts the characters (Trent from `tools/trent.png`, Juni from `tools/juni.jpg`) and the title (from the mockup) out of their backgrounds with rembg, grades the characters to match the nebula, and builds the nebula backdrop. |
| `admin/` | The CMS. |

### Layout

The page is a centred column, at most 1200px wide, that scrolls over a fixed nebula backdrop. Trent (left) and Juni (right) stand fixed just outside the column, partly behind it, so they stay at the sides as the window gets wider. The nav buttons stick to the top while you scroll. The footer panels are pinned to the bottom of the window and scaled to the column width. Below 900px wide the page switches to a stacked phone layout.

## The CMS

The CMS is a static page that commits to this repository through the GitHub API, so no server is involved. GitHub Pages republishes about a minute after each save.

**One-time setup:** create a fine-grained token for the CMS:

1. GitHub → Settings → Developer settings → [Fine-grained tokens → Generate new token](https://github.com/settings/personal-access-tokens/new)
2. Repository access: *Only select repositories* → this repository
3. Repository permissions: **Contents → Read and write**
4. Open `/admin/` on the site, paste the token and sign in. It stays in your browser only.

You can then:

- **News**: write, edit, unpublish (draft) and delete posts. Each post has a timeline image (shown in the round frame), an excerpt for the timeline and a full Markdown body with a live preview. You can upload images and embed YouTube videos.
- **Pages**: edit Support, Gallery, About and Download. Put several images on one line in the Gallery to get a grid.
- **Settings**: tagline, build badge, project status percentage and text, Community Hub links (an empty link disables its button) and footer text.

Uploaded images go to `images/uploads/`.

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

The CMS also works locally at `http://localhost:8000/admin/`. It still saves to GitHub, not to your local files, so `git pull` afterwards.

## Re-cutting the UI assets

If the mockup changes, replace `tools/mockup.png` and run:

```sh
pip install numpy pillow opencv-python-headless "rembg[cpu]"
python3 tools/extract_assets.py
python3 tools/build_layers.py   # first run downloads ~1 GB of segmentation models
```

To swap a character, replace `tools/trent.png` or `tools/juni.jpg` and run `python3 tools/build_layers.py characters`. If the new render's proportions differ, update the crop box in the script and `--ar` (width / height of the cutout) in `css/site.css`.

Crop coordinates are at the top of each script.

## Credits

Background: [“Cosmic Cliffs” in the Carina Nebula](https://webbtelescope.org/contents/media/images/2022/031/01G77PKB8NKR7S8Z6HBXMYATGJ) by NASA, ESA, CSA and STScI (public domain), rotated and cropped.

---

Sirius Reborn is a fan project and is not affiliated with Microsoft or Digital Anvil. Freelancer is a registered trademark of Microsoft Corporation.
