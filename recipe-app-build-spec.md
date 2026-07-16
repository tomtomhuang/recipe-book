# 食譜 App — Build Specification (味之書)

This document is a complete brief for building a Traditional-Chinese, phone-first recipe web app. It is written to be handed to Claude Code as the opening instruction. Two reference prototype HTML files accompany this spec (the refined recipe view, and the add-recipe form) — build to match their look and behaviour.

---

## 1. Project summary

A Progressive Web App (PWA) for a couple to write, store, browse, and cook from their personal recipes. Built as a gift; intended to last many years across device changes. Entirely in Traditional Chinese (繁體中文). Phone-first (the primary user cooks from her phone), but must also work on desktop browsers.

**Access model:** Anyone with the link can VIEW recipes (read-only). A single shared administrator login unlocks all editing (add / edit / delete). Once logged in on a device, that device stays logged in.

---

## 2. Tech stack (already decided — do not substitute)

- **Front end:** Plain, dependency-light web app (HTML/CSS/JS or a lightweight framework at Claude Code's discretion), built as an installable **PWA** with offline *viewing* of previously loaded recipes.
- **Hosting:** **GitHub Pages** (user has a GitHub account but is a git beginner — Claude Code drives all git operations). Final link will look like `https://<username>.github.io/<repo>/`.
- **Backend (data, photos, auth):** **Supabase** free tier.
  - Postgres database — recipe content
  - Storage buckets — cover photos and step photos
  - Auth — the single admin login
- **Photo handling:** Compress/resize images in-browser before upload (phone photos are large) to conserve free-tier storage and keep the app fast.

### Supabase credentials (user will paste real values at build time)
```
SUPABASE_URL:            https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY: sb_publishable_...   (client-side key — safe to ship in the app)
```
Do NOT put the Supabase **secret** key (`sb_secret_...`) or service_role key anywhere in the client app. Only the publishable/anon key belongs in front-end code.

### Known free-tier caveat to handle gracefully
Supabase free projects **pause after ~1 week of inactivity**. If the app ever loads and the backend is paused/unreachable, show a friendly message (in 繁體中文) rather than a blank error, and the user can un-pause from the Supabase dashboard.

---

## 3. Design direction

Base look = "Warm Kitchen": warm cream/clay palette, soft rounded cards, Noto Serif TC for titles + Noto Sans TC for body. Match the accompanying refined prototype exactly for colours, spacing, and card styling. Navigation uses a **phone-native bottom navigation bar** with a floating central "＋" add button.

Suggested palette (from the prototype):
```
cream  #FBF6EE   card #FFFFFF   ink #2E2A24   muted #8A8072
clay   #C2683F   clay-soft #E8CDBE   sage #7D8B6A   line #EFE6D8
```

---

## 4. Screens & navigation

Bottom nav items: **食譜 (home/list)**, **搜尋 (search)**, **＋ (add — centre floating button, admin only)**, **最愛 (favourites)**, **我的 (settings/account)**.

### 4.1 Recipe list (home)
- Grid of recipe cards: cover photo, name, tag chips, and meta (time / servings).
- Favourite recipes show a heart indicator.
- Horizontally scrollable tag filter row at top (全部, ⭐最愛, then tags).
- Search bar (by recipe name, ingredient, or tag).
- Cards adapt: 1–2 columns on phone, more on desktop.

### 4.2 Recipe detail
- Cover hero image with tag chips.
- Title + meta row: 準備時間 / 烹煮時間 / 份量.
- **Ingredients section** — clean panel style. Each row: name (+ category chip), optional italic note beneath, amount + unit on the right.
  - **Servings scaler**: a stepper adjusts the serving count and multiplies numeric amounts live. Non-numeric amounts (e.g. 少許, 適量) are left unscaled.
- **Method section** — numbered steps; each step may have an optional photo.
- **References section (靈感來源)** — list of saved links (YouTube / websites), optional.
- **Notes section (心得 · 筆記)** — freeform text, optional.
- When logged in as admin: an **編輯** button and a **刪除** button (delete asks for confirmation).

### 4.3 Add / Edit recipe (admin only)
Same form for both; Edit pre-fills current content. Match the add-recipe prototype. Fields, top to bottom:
- **Cover photo** uploader (tap to pick; shows preview; can replace).
- **Title** (食譜名稱).
- **Meta**: 準備時間, 烹煮時間, 份量(人數).
- **Tags**: add multiple; existing tags offered as tap-to-add suggestions to avoid duplicates; removable pills.
- **Ingredients** (the important interaction):
  - Each row: name, amount, unit, and an **optional note** field (e.g. 雞肉 → 需要清遠雞; 雞髀 → 雞上腿肉).
  - **Reusable ingredient library with autocomplete**: as the user types a name, show a dropdown of previously-used ingredients **grouped by category**, filtered live. Selecting one **auto-fills its default unit**. If the ingredient is new, offer "＋ 新增「X」為新食材" to save it to the library for future reuse.
  - Unit is overridable per recipe for flexibility.
- **Method steps**: add/remove/reorder numbered steps; each step has a text box and an **optional photo** (with preview + remove).
- **References**: repeatable link rows (add/remove).
- **Notes**: freeform textarea.
- **Save** and **Cancel**. Save writes to Supabase; validate that at least a title exists.

### 4.4 Settings / 我的
- Admin **login / logout**.
- **Management screen for presets** (build now, for future use): add / rename / reorder **ingredient categories** and **units**. Editable so the user is never locked into the starter list.

---

## 5. Data model

Design the Supabase schema to support the above. Suggested tables (Claude Code may refine, but keep the shape):

- **recipes**: id, title, cover_photo_url, prep_time (text), cook_time (text), base_servings (int), notes (text), created_at, updated_at.
- **ingredients_library**: id, name, category_id (fk), default_unit, created_at. (The reusable master list — each ingredient stored once.)
- **recipe_ingredients**: id, recipe_id (fk), library_ingredient_id (fk, nullable for ad-hoc), name (denormalised for display), amount (numeric, nullable), amount_text (for non-numeric like 少許/適量), unit, note (nullable), sort_order.
- **recipe_steps**: id, recipe_id (fk), step_number, text, photo_url (nullable), sort_order.
- **recipe_references**: id, recipe_id (fk), url, label (nullable), sort_order.
- **tags**: id, name. **recipe_tags**: recipe_id, tag_id. (Many-to-many.)
- **categories**: id, name, sort_order. **units**: id, name, sort_order. (Editable presets.)
- **favourites**: recipe_id (a simple flag/boolean on recipes is also acceptable given single shared admin).

### Row Level Security (important)
- Public (anon) role: **SELECT only** on all recipe-content tables and storage read — so anyone with the link can view.
- Authenticated (admin) role: **full INSERT / UPDATE / DELETE**.
- Configure Supabase Storage buckets: public read for photos; authenticated write.

---

## 6. Preset seed data (starter, editable later)

**Ingredient categories (分類):**
肉類, 海鮮, 蔬菜, 醬料, 調味, 乾貨, 蛋奶, 其他

**Units (單位):**
克, 公斤, 毫升, 湯匙, 茶匙, 杯, 個, 片, 條, 隻, 瓣, 少許, 適量

Seed these on first setup. All are editable via the Settings management screen.

---

## 7. PWA requirements

- Web app manifest (name 味之書 / "我的食譜簿", icons, theme colours matching the cream/clay palette, display: standalone, portrait).
- Service worker that caches the app shell and previously viewed recipes + their photos, so the primary user can **read recipes offline** (e.g. poor kitchen signal). Editing offline is out of scope — edits require connectivity.
- "Add to Home Screen" should work on iOS Safari and Android Chrome, opening fullscreen with its own icon.
- Re-sync automatically when connectivity returns.

---

## 8. Language & localisation

- Entire UI in **繁體中文**. Sample/placeholder text in 繁體中文.
- Sensible Chinese date formatting where dates appear.

---

## 9. Build & deploy sequence (guide the beginner through each)

The user is new to GitHub and Supabase. Walk them through, one clear step at a time, pausing for confirmation:

1. **Scaffold** the project locally.
2. **Supabase setup**: with the user, create the tables (SQL provided by you), enable Row Level Security with the policies in §5, create the storage buckets, seed the preset data (§6), and create the single **admin user** (email + password of the user's choosing) in Supabase Auth.
3. **Wire credentials**: put `SUPABASE_URL` + publishable key into the app config.
4. **Build all screens & features** per §4–§7, matching the two prototypes.
5. **Test locally**: view, add, edit, delete, servings scaling, ingredient autocomplete, photo upload/compression, offline viewing, admin login.
6. **GitHub**: create the repository and push (Claude Code performs git operations; explain what each does in plain language). If a personal access token or auth prompt is needed, tell the user exactly what to click and what kind to create.
7. **Enable GitHub Pages** on the repo and confirm the live link works.
8. **PWA check**: install to phone home screen; verify offline viewing and that the primary user can log in once and stay logged in.
9. Hand over the final link and a short "how to add a recipe" note in 繁體中文.

---

## 10. Acceptance checklist

- [ ] Public visitor can browse & view all recipes read-only via the link.
- [ ] Admin login unlocks add / edit / delete everywhere.
- [ ] Add-recipe: ingredient autocomplete from reusable library, grouped by category, auto-fills unit, allows new ingredients, supports per-ingredient optional notes.
- [ ] Optional photo per cooking step, plus a cover photo; images compressed before upload.
- [ ] Servings scaler multiplies numeric amounts; leaves 少許/適量 untouched.
- [ ] Tags: multi-tag, filterable, duplicate-avoiding suggestions.
- [ ] References and freeform notes sections per recipe.
- [ ] Editable category & unit management screen.
- [ ] Installs as a PWA; previously viewed recipes readable offline.
- [ ] Entire UI in Traditional Chinese.
- [ ] Warm Kitchen visual style + bottom nav, matching the prototypes.
- [ ] Graceful message if Supabase project is paused/unreachable.

---

## 11. Opening message to paste into Claude Code

> Build a Traditional-Chinese (繁體中文), phone-first PWA recipe app for my wife and me, following the attached build specification and the two prototype HTML files (refined recipe view + add-recipe form). Use Supabase (free tier) for the database, photo storage, and a single shared admin login, and deploy to GitHub Pages. I have a GitHub account but I'm a beginner with git, so please drive all git operations and walk me through the Supabase setup step by step, pausing for me to confirm. Start by reviewing the spec and prototypes, then outline the build plan before writing code.
