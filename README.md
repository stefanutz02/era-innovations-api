<div align="center">

# ERA Innovations — API

**Backend for `erainnovations.ro`.**
Contact-form mailer · Markdown blog server · Deployed on DirectAdmin.

`email-api.erainnovations.ro`

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4-000000?style=flat-square&logo=express)](https://expressjs.com/)
[![License: Proprietary](https://img.shields.io/badge/License-All_Rights_Reserved-red?style=flat-square)](LICENSE)

</div>

---

## Overview

This is the backend service that powers two pieces of the **ERA Innovations** corporate website at [erainnovations.ro](https://erainnovations.ro):

1. The **contact form** — accepts submissions and emails them to the team via SMTP.
2. The **blog** — serves markdown posts as JSON so the React frontend can render them without a rebuild.

It is intentionally small (~250 lines, one `server.js` file, no database) and runs as a Node.js application under DirectAdmin at `email-api.erainnovations.ro`.

## Endpoints

| Method | Path           | Purpose                                                 | Cache  |
| ------ | -------------- | ------------------------------------------------------- | ------ |
| GET    | `/`            | Status check                                            | —      |
| GET    | `/health`      | Detailed health (uptime, env, posts directory)          | —      |
| POST   | `/contact`     | Send contact-form email (rate-limited: 5 req / 15 min)  | —      |
| GET    | `/blog`        | List all posts (metadata only)                          | 60 s   |
| GET    | `/blog/:slug`  | Single post with rendered HTML                          | 5 min  |

### `POST /contact`

```json
{
  "name": "Ion Popescu",
  "email": "ion@firma.ro",
  "message": "Vrem să construim o aplicație mobilă.",
  "company": "Firma SRL"
}
```

- `name`, `email`, `message` are required. `company` is optional.
- Returns `200 { "success": true }` or `4xx/5xx { "error": "..." }`.
- Rate limit: 5 requests per IP per 15 minutes.

### `GET /blog`

```json
{
  "posts": [
    {
      "slug": "cat-costa-website-2026",
      "title": "Cât costă un website în 2026?",
      "title_en": "How much does a website cost in 2026?",
      "date": "2025-11-19",
      "category": "Pricing",
      "excerpt": "...",
      "excerpt_en": "...",
      "readingTime": 4
    }
  ]
}
```

### `GET /blog/:slug`

Returns the metadata above plus a `content` field with fully rendered HTML and `rawContent` with the original markdown. The slug is sanitized — only `[a-zA-Z0-9-]` is accepted, so path traversal (`../../etc/passwd`) is impossible.

## How the blog works

Markdown posts live in a folder on the server (path set via `POSTS_DIR`). Each `.md` file has YAML-style frontmatter followed by the body:

```markdown
---
title: "Cât costă un website în 2026?"
title_en: "How much does a website cost in 2026?"
date: "2025-11-19"
category: "Pricing"
excerpt: "Un rezumat scurt în română..."
excerpt_en: "Short English summary..."
slug: "cat-costa-website-2026"
---

# Cât costă un website în 2026?

Conținutul articolului în **Markdown**. `marked` îl randează la HTML la cerere.

## Subtitlu

- Punct 1
- Punct 2
```

**Adding a new post — no redeploy needed:**

1. Drop a new file `posts/your-slug.md` on the server (DirectAdmin File Manager or SFTP).
2. The filename must match `[a-z0-9-]+` (lowercase, digits, hyphens only).
3. Save. The website's blog page picks it up within ~60 seconds (cache window).

## Why this architecture

- **Markdown on the filesystem, not in the bundle.** Posts can be edited or added by anyone with SFTP access — no React rebuild, no deploy.
- **No database.** The filesystem *is* the content store. Backups = the `posts/` folder.
- **Stateless service.** Restarting the Node.js app loses nothing.
- **Rate limit only on `/contact`.** Blog reads are free and cached at the HTTP layer.
- **Defense in depth:** `helmet` + strict CORS + slug allowlist + frontmatter validation + HTML escaping in outgoing emails.

## Deployment — DirectAdmin

1. **DirectAdmin → Setup a Node.js App**
   - App URL: `email-api.erainnovations.ro`
   - Application startup file: `server.js`
   - Node.js version: 18 or higher
2. **Upload files** to the app folder (everything except `node_modules/` and `.env`).
3. **Run NPM Install** from the DirectAdmin Node.js panel.
4. **Set environment variables** in the panel using `.env.example` as a template.
5. **Create the `posts/` directory** next to `server.js` (or wherever `POSTS_DIR` points). Drop seed markdown files in.
6. **Start the app** from the panel. Visit `https://email-api.erainnovations.ro` — you should see:
   ```json
   { "status": "ERA Innovations — API online" }
   ```
7. **Enable HTTPS** in DirectAdmin → SSL Certificates (Let's Encrypt) for the subdomain.

## Local development

```bash
git clone <repo>
cd era-innov-api
cp .env.example .env       # fill in real values
npm install
npm run dev                # auto-restarts on file change (Node 18+)
```

In another terminal:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/blog
```

## Project structure

```
.
├── server.js          # The entire API (~250 lines)
├── posts/             # Markdown blog posts (one .md per post)
│   └── cat-costa-website-2026.md
├── package.json
├── .env.example       # Template for environment variables
├── .gitignore
├── LICENSE            # Proprietary — All Rights Reserved
└── README.md
```

## Tech stack

- **express** — HTTP server
- **nodemailer** — SMTP client for outgoing email
- **helmet** — sensible default security headers
- **cors** — origin allowlist for browser fetches
- **express-rate-limit** — per-IP throttling on `/contact`
- **marked** — Markdown → HTML renderer

No database. No build step. No framework on top of Express.

## Security notes

- **CORS allowlist** restricts which domains can call the API from a browser. Only `erainnovations.ro` (with and without `www.`) is permitted in production.
- **Rate limit** on `/contact` blocks form spam.
- **Helmet** sets a baseline of security headers (CSP, X-Frame-Options, etc.).
- **Slug validation** on `/blog/:slug` blocks path traversal.
- **HTML escaping** in the email body prevents injection in the recipient's inbox.
- **SMTP credentials** live in environment variables, never in source.

In production, ensure: the DirectAdmin Node.js app runs as an unprivileged user; the `posts/` directory is writable only by the deploy user; HTTPS is enforced; and DirectAdmin's firewall blocks public access to the Node.js port (only the reverse proxy should reach it).

## Companion repositories

| Repo                  | Role                                         |
| --------------------- | -------------------------------------------- |
| **era-innov-api**     | This repo — the backend.                     |
| **era-innov-website** | Frontend that consumes this API.             |

## License

**Proprietary — All Rights Reserved.** See [LICENSE](LICENSE).

This is closed-source commercial software. No license is granted to use, copy, modify, or distribute it. For partnership or licensing inquiries: `office@erainnovations.ro`.
