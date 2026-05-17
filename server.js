// =============================================================================
// ERA Innovations — API
// email-api.erainnovations.ro
//
// Serves the erainnovations.ro website only.
//   GET  /                  — status
//   GET  /health            — uptime + env info
//   POST /contact           — contact-form email (rate-limited)
//   GET  /blog              — list all posts (metadata)
//   GET  /blog/:slug        — single post (rendered HTML + metadata)
// =============================================================================

const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const app = express();
const PORT = process.env.PORT || 3000;
const POSTS_DIR = process.env.POSTS_DIR || path.join(__dirname, 'posts');

// -----------------------------------------------------------------------------
// Middleware
// -----------------------------------------------------------------------------
app.use(helmet());
app.use(express.json());

app.use(
  cors({
    origin: [
      'https://erainnovations.ro',
      'https://www.erainnovations.ro',
      // dev origins
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  })
);

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/contact', contactLimiter);

// -----------------------------------------------------------------------------
// SMTP
// -----------------------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error) => {
  if (error) console.error('SMTP error:', error);
  else console.log('SMTP ready');
});

// -----------------------------------------------------------------------------
// Health
// -----------------------------------------------------------------------------
app.get('/', (_req, res) => {
  res.json({ status: 'ERA Innovations — API online' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    postsDir: POSTS_DIR,
  });
});

// -----------------------------------------------------------------------------
// Contact form
// -----------------------------------------------------------------------------
app.post('/contact', async (req, res) => {
  try {
    const { name, email, message, company } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    await transporter.sendMail({
      from: `"ERA Innovations Website" <${process.env.SMTP_USER}>`,
      to: process.env.TO_EMAIL,
      replyTo: email,
      subject: `[ERA Innovations] New message from ${name}`,
      text:
        `Name: ${name}\n` +
        `Email: ${email}\n` +
        `Company: ${company || '—'}\n\n` +
        `Message:\n${message}`,
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;background:#0a0a0a;color:#fafafa;border-radius:12px;max-width:600px">
          <h2 style="color:#8b5cf6;margin:0 0 16px">New Contact Message</h2>
          <p style="margin:4px 0"><strong>From:</strong> ${escapeHtml(name)}</p>
          <p style="margin:4px 0"><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}" style="color:#a78bfa">${escapeHtml(email)}</a></p>
          ${company ? `<p style="margin:4px 0"><strong>Company:</strong> ${escapeHtml(company)}</p>` : ''}
          <p style="margin:4px 0"><strong>Source:</strong> erainnovations.ro</p>
          <hr style="border:0;border-top:1px solid #333;margin:16px 0">
          <p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(message)}</p>
        </div>
      `,
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// -----------------------------------------------------------------------------
// Blog
// -----------------------------------------------------------------------------
function parseFrontmatter(raw) {
  if (!raw.trim().startsWith('---')) {
    return { data: {}, content: raw };
  }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };

  const [, fm, content] = match;
  const data = {};
  for (const line of fm.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, content };
}

function readPost(slug) {
  if (!/^[a-z0-9-]+$/i.test(slug)) {
    throw new Error('Invalid slug');
  }
  const filePath = path.join(POSTS_DIR, `${slug}.md`);
  if (!filePath.startsWith(POSTS_DIR)) throw new Error('Invalid path');
  if (!fs.existsSync(filePath)) throw new Error('Not found');

  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = parseFrontmatter(raw);
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  return {
    slug: data.slug || slug,
    title: data.title || 'Untitled',
    title_en: data.title_en || data.title || 'Untitled',
    date: data.date || new Date().toISOString(),
    category: data.category || 'General',
    excerpt: data.excerpt || '',
    excerpt_en: data.excerpt_en || data.excerpt || '',
    rawContent: content,
    readingTime,
  };
}

app.get('/blog', (_req, res) => {
  try {
    if (!fs.existsSync(POSTS_DIR)) {
      return res.json({ posts: [] });
    }

    const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));

    const posts = files
      .map((f) => {
        try {
          const slug = f.replace(/\.md$/, '');
          const post = readPost(slug);
          // strip raw content from list response
          const { rawContent, ...meta } = post;
          return meta;
        } catch (e) {
          console.error('Skipping post', f, e.message);
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.set('Cache-Control', 'public, max-age=60');
    res.json({ posts });
  } catch (err) {
    console.error('Blog list error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

app.get('/blog/:slug', async (req, res) => {
  try {
    const post = readPost(req.params.slug);
    const html = await marked.parse(post.rawContent);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ ...post, content: html });
  } catch (err) {
    if (err.message === 'Not found' || err.message === 'Invalid slug') {
      return res.status(404).json({ error: 'Post not found' });
    }
    console.error('Blog post error:', err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`ERA Innovations API running on port ${PORT}`);
  console.log(`Posts directory: ${POSTS_DIR}`);
});
