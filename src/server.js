/**
 * Simple Web File Server (no auth)
 * Features: list, upload, delete, mkdir, rename, download (range), static UI
 * - Supports Chinese filenames
 * - Avoids name collisions by appending (n)
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const express = require('express');
const multer = require('multer');
const mime = require('mime-types');

const app = express();

// Config
const PORT = process.env.PORT || 3000;
const ROOT_DIR = process.env.ROOT_DIR || path.resolve(process.cwd(), 'storage');
const DEFAULT_QUOTA = process.env.QUOTA_BYTES ? Number(process.env.QUOTA_BYTES) : Infinity; // bytes, Infinity for unlimited
let quotaBytes = Number.isFinite(DEFAULT_QUOTA) && DEFAULT_QUOTA >= 0 ? DEFAULT_QUOTA : Infinity;

// Ensure storage and temp dir
fs.mkdirSync(ROOT_DIR, { recursive: true });
const TMP_DIR = path.join(ROOT_DIR, '.tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

// Multer storage to temp then we move to avoid collisions
const upload = multer({ dest: TMP_DIR });

// best-effort cleanup of stale temp files (older than 24h)
async function cleanupTmp() {
  try{
    const now = Date.now();
    const files = await fsp.readdir(TMP_DIR);
    await Promise.all(files.map(async f => {
      const fp = path.join(TMP_DIR, f);
      try{
        const st = await fsp.stat(fp);
        if (!st.isDirectory() && (now - st.mtimeMs) > 24*60*60*1000) {
          await fsp.rm(fp, { force: true });
        }
      }catch{}
    }));
  }catch{}
}
setInterval(cleanupTmp, 6*60*60*1000).unref();
cleanupTmp();

// Calculate used bytes under ROOT_DIR (excluding .tmp)
async function getUsedBytes() {
  let total = 0;
  const stack = [ROOT_DIR];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (dir === ROOT_DIR && ent.name === '.tmp') continue; // skip temp
      const p = path.join(dir, ent.name);
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) stack.push(p);
        else total += st.size;
      } catch {}
    }
  }
  return total;
}

app.use(express.json());

// CORS for convenience
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Helpers
function safeJoin(root, p) {
  const resolved = path.resolve(root, p || '.');
  if (!resolved.startsWith(root)) throw new Error('Path escapes root');
  return resolved;
}

function splitNameExt(filename) {
  const ext = path.extname(filename);
  const name = filename.slice(0, filename.length - ext.length);
  return { name, ext };
}

async function uniqueName(dir, desired) {
  const { name, ext } = splitNameExt(desired);
  let candidate = desired;
  let i = 1;
  while (true) {
    try {
      await fsp.access(path.join(dir, candidate));
      candidate = `${name} (${i})${ext}`;
      i++;
    } catch {
      return candidate;
    }
  }
}

async function statToEntry(base, name) {
  const p = path.join(base, name);
  const s = await fsp.stat(p);
  return {
    name,
    isDir: s.isDirectory(),
    size: s.isDirectory() ? null : s.size,
    mtime: s.mtimeMs,
  };
}

// List directory
app.get('/api/list', async (req, res) => {
  try {
    const dir = safeJoin(ROOT_DIR, req.query.path || '.');
    const names = await fsp.readdir(dir, { withFileTypes: true });
    const entries = await Promise.all(
      names.map(d => statToEntry(dir, d.name))
    );
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    const used = await getUsedBytes();
    res.json({ ok: true, entries, quota: { used, limit: Number.isFinite(quotaBytes) ? quotaBytes : null } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Get quota
app.get('/api/quota', async (req, res) => {
  try {
    const used = await getUsedBytes();
    res.json({ ok: true, used, limit: Number.isFinite(quotaBytes) ? quotaBytes : null });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Set quota (bytes). Pass null or negative for unlimited.
app.post('/api/quota', async (req, res) => {
  try {
    let { limit } = req.body || {};
    if (limit === null || limit === undefined || Number(limit) < 0) {
      quotaBytes = Infinity;
    } else {
      limit = Number(limit);
      if (!Number.isFinite(limit)) throw new Error('limit must be a number');
      quotaBytes = Math.max(0, Math.floor(limit));
    }
    const used = await getUsedBytes();
    res.json({ ok: true, used, limit: Number.isFinite(quotaBytes) ? quotaBytes : null });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Create directory
app.post('/api/mkdir', async (req, res) => {
  try {
    const { dirPath, name } = req.body || {};
    if (!name) throw new Error('name required');
    const parent = safeJoin(ROOT_DIR, dirPath || '.');
    const finalName = await uniqueName(parent, name);
    await fsp.mkdir(path.join(parent, finalName), { recursive: false });
    res.json({ ok: true, name: finalName });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Rename file or directory (collision-safe)
app.post('/api/rename', async (req, res) => {
  try {
    const { dirPath, oldName, newName } = req.body || {};
    if (!oldName || !newName) throw new Error('oldName and newName required');
    const dir = safeJoin(ROOT_DIR, dirPath || '.');
    const from = path.join(dir, oldName);
    await fsp.access(from);
    const finalName = await uniqueName(dir, newName);
    const to = path.join(dir, finalName);
    await fsp.rename(from, to);
    res.json({ ok: true, name: finalName });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Delete file or directory (recursive)
app.post('/api/delete', async (req, res) => {
  try {
    const { dirPath, name } = req.body || {};
    if (!name) throw new Error('name required');
    const dir = safeJoin(ROOT_DIR, dirPath || '.');
    const target = path.join(dir, name);
    await fsp.rm(target, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Upload files (multiple)
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const dirPath = req.body?.dirPath || '.';
    const dir = safeJoin(ROOT_DIR, dirPath);
    await fsp.mkdir(dir, { recursive: true });
    const saved = [];
    // Quota pre-check: sum of incoming file sizes
    if (Number.isFinite(quotaBytes)) {
      let incoming = 0;
      for (const f of req.files || []) incoming += f.size || 0;
      const used = await getUsedBytes();
      if (used + incoming > quotaBytes) {
        // cleanup tmp uploads
        for (const f of req.files || []) {
          try { await fsp.rm(f.path, { force: true }); } catch {}
        }
        return res.status(413).json({ ok: false, error: 'Storage quota exceeded' });
      }
    }
    for (const file of req.files || []) {
      // Original name supports Chinese
      const desired = file.originalname;
      const finalName = await uniqueName(dir, desired);
      await fsp.rename(file.path, path.join(dir, finalName));
      saved.push(finalName);
    }
    const used = await getUsedBytes();
    res.json({ ok: true, files: saved, quota: { used, limit: Number.isFinite(quotaBytes) ? quotaBytes : null } });
  } catch (e) {
    // Cleanup temp files on error
    try {
      for (const f of req.files || []) {
        await fsp.rm(f.path, { force: true });
      }
    } catch {}
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Download (supports Range for resume)
app.get('/api/download', async (req, res) => {
  try {
    const { filePath } = req.query || {};
    if (!filePath) throw new Error('filePath required');
    const full = safeJoin(ROOT_DIR, filePath);
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) throw new Error('Cannot download a directory');

    const mimeType = mime.lookup(full) || 'application/octet-stream';
    const fileName = path.basename(full);

    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      if (m) {
        if (m[1]) start = parseInt(m[1], 10);
        if (m[2]) end = parseInt(m[2], 10);
        if (isNaN(start) || isNaN(end) || start > end || end >= stat.size) {
          return res.status(416).set({ 'Content-Range': `bytes */${stat.size}` }).end();
        }
        status = 206;
      }
    }

    res.status(status);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes',
      'Content-Range': status === 206 ? `bytes ${start}-${end}/${stat.size}` : undefined,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    fs.createReadStream(full, { start, end }).pipe(res);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Serve static frontend
app.use('/', express.static(path.join(__dirname, '../public')));

app.listen(PORT, () => {
  console.log(`File server running at http://localhost:${PORT}`);
  console.log(`Root dir: ${ROOT_DIR}`);
});
