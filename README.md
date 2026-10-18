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
| `assets/ui/` | Every button, frame and panel, cropped straight from the mockup. |
| `tools/extract_assets.py` | The script that crops `assets/ui/` from `tools/mockup.png`. |
| `admin/` | The CMS. |

### Layout

On desktop the page *is* the mockup: a 1712px-wide stage in mockup pixel coordinates, scaled to the window with CSS `zoom`. The hero art, the nav buttons and the footer are fixed; the news panel scrolls over the hero and under the always-visible footer. Below 900px wide the page switches to a stacked phone layout.

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
pip install numpy pillow opencv-python-headless
python3 tools/extract_assets.py
```

Crop coordinates are at the top of the script. The CSS positions in `css/site.css` use the same coordinates, minus the 78px browser chrome at the top of the mockup.

---

Sirius Reborn is a fan project and is not affiliated with Microsoft or Digital Anvil. Freelancer is a registered trademark of Microsoft Corporation.
