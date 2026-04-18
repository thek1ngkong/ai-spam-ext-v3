// AI-SPAM Background Service Worker
// Calls your backend server — no API keys needed by users

// ── CONFIG — update SERVER_URL after you deploy your backend ──────────────────
const SERVER_URL       = 'https://ai-spam-server-production.up.railway.app';
const EXTENSION_SECRET = 'make-up-any-random-string-here';  // ← change this


// ── Message Handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzeEmail') {
    runScan(request.emailData)
      .then(result => sendResponse({ success: true, result }))
      .catch(err  => sendResponse({ success: false, error: err.message }));
    return true; // keep channel open for async
  }
  if (request.action === 'checkServer') {
    checkServer()
      .then(ok => sendResponse({ ok }))
      .catch(()  => sendResponse({ ok: false }));
    return true;
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
async function checkServer() {
  const res = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const data = await res.json();
  return data.status === 'ok';
}

// ── Run scan via backend ───────────────────────────────────────────────────────
async function runScan(emailData) {
  if (!SERVER_URL || SERVER_URL.includes('your-server')) {
    throw new Error(
      'Backend URL not configured.\n' +
      'Deploy the server and update SERVER_URL in background.js'
    );
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${SERVER_URL}/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-extension-secret': EXTENSION_SECRET,
        },
        body: JSON.stringify(emailData),
      });

      // Handle rate limit with retry
      if (res.status === 429) {
        if (attempt < 3) {
          await sleep(4000 * attempt);
          continue;
        }
        throw new Error('Server is busy. Please wait 30 seconds and try again.');
      }

      if (res.status === 401) {
        throw new Error('Extension secret mismatch. Check EXTENSION_SECRET in background.js matches your server .env');
      }

      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Scan failed on server.');

      console.log(`✅ Scan complete via ${data.meta?.provider}/${data.meta?.model}`);
      return data.result;

    } catch (err) {
      lastError = err;
      // Only retry on network/rate limit errors
      const isRetryable =
        err.message.includes('fetch') ||
        err.message.includes('network') ||
        err.message.includes('busy');
      if (!isRetryable || attempt === 3) throw err;
      await sleep(3000 * attempt);
    }
  }
  throw lastError;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
