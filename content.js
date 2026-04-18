// AI-SPAM Content Script — Gmail Email Extractor
// Injected into mail.google.com to extract email data

(function () {
  'use strict';

  /**
   * Extract the currently open email from Gmail's DOM.
   * Tries multiple selector strategies for resilience across Gmail versions.
   */
  function extractCurrentEmail() {
    try {
      // ── 1. Detect if an email is open ──────────────────────────────────────
      const threadContainer =
        document.querySelector('.ha') ||       // thread view
        document.querySelector('.ii.gt') ||    // message body wrapper
        document.querySelector('.adn.ads');    // expanded message

      if (!threadContainer) {
        return {
          error: 'NO_EMAIL_OPEN',
          message: 'No email is currently open. Please click on an email in Gmail first, then scan.'
        };
      }

      // ── 2. Subject ──────────────────────────────────────────────────────────
      const subjectEl =
        document.querySelector('h2.hP') ||
        document.querySelector('[data-thread-perm-id] h2') ||
        document.querySelector('.bog');
      const subject = subjectEl
        ? subjectEl.textContent.trim()
        : 'Subject not detected';

      // ── 3. Find the last expanded message in the thread ────────────────────
      const allMessages = document.querySelectorAll('.adn.ads');
      const lastMsg = allMessages.length
        ? allMessages[allMessages.length - 1]
        : document;

      // ── 4. Sender name & email ─────────────────────────────────────────────
      let senderName = 'Unknown Sender';
      let senderEmail = 'unknown@unknown.com';

      const senderEl =
        (lastMsg !== document ? lastMsg.querySelector('.gD') : null) ||
        document.querySelector('.gD');

      if (senderEl) {
        senderName =
          senderEl.getAttribute('name') ||
          senderEl.textContent.trim() ||
          'Unknown';
        senderEmail =
          senderEl.getAttribute('email') ||
          senderEl.getAttribute('data-hovercard-id') ||
          senderEl.textContent.trim();
      }

      // Fallback: try hovercards
      if (senderEmail === 'unknown@unknown.com') {
        const hoverEl = document.querySelector('[data-hovercard-id*="@"]');
        if (hoverEl) {
          senderEmail = hoverEl.getAttribute('data-hovercard-id');
          senderName = hoverEl.textContent.trim() || senderEmail;
        }
      }

      // ── 5. Reply-To ─────────────────────────────────────────────────────────
      let replyTo = null;
      const extraHeaders = lastMsg !== document
        ? lastMsg.querySelectorAll('.aJ5')
        : document.querySelectorAll('.aJ5');
      extraHeaders.forEach(el => {
        const text = el.textContent.toLowerCase();
        if (text.includes('reply-to') || text.includes('mailed-by')) {
          const emailAttr = el.querySelector('[email]');
          if (emailAttr) replyTo = emailAttr.getAttribute('email');
        }
      });

      // ── 6. Email body ───────────────────────────────────────────────────────
      const bodyEl =
        (lastMsg !== document ? lastMsg.querySelector('.a3s.aiL') : null) ||
        document.querySelector('.a3s.aiL') ||
        document.querySelector('.a3s') ||
        document.querySelector('.ii.gt div[dir]');

      let bodyText = '';
      const links = [];

      if (bodyEl) {
        bodyText = (bodyEl.innerText || bodyEl.textContent).trim();

        // Extract all anchor links
        bodyEl.querySelectorAll('a[href]').forEach(a => {
          const href = a.href || '';
          const text = a.textContent.trim();
          // Exclude mailto and internal Gmail links
          if (
            href &&
            !href.startsWith('mailto:') &&
            !href.includes('mail.google.com') &&
            !href.startsWith('#')
          ) {
            links.push({ text: text || href, href });
          }
        });

        // Also catch any raw URLs in text (basic detection)
        const urlRegex = /https?:\/\/[^\s"'<>]+/g;
        const rawUrls = bodyEl.textContent.match(urlRegex) || [];
        rawUrls.forEach(url => {
          if (!links.find(l => l.href === url)) {
            links.push({ text: url, href: url });
          }
        });
      }

      // ── 7. Attachments ──────────────────────────────────────────────────────
      const attachments = [];
      const attSelectors = ['.aZo', '.aQw', '.brc', '[download]'];
      attSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(att => {
          const nameEl =
            att.querySelector('.aV3') ||
            att.querySelector('.iO') ||
            att.querySelector('span[title]') ||
            att;
          const name =
            nameEl.getAttribute('title') ||
            nameEl.textContent.trim();
          if (name && !attachments.includes(name)) {
            attachments.push(name);
          }
        });
      });

      // ── 8. Date ─────────────────────────────────────────────────────────────
      const dateEl =
        (lastMsg !== document ? lastMsg.querySelector('.g3') : null) ||
        document.querySelector('.g3');
      const date = dateEl
        ? dateEl.getAttribute('title') || dateEl.textContent.trim()
        : 'Unknown date';

      // ── 9. Extract sender domain ────────────────────────────────────────────
      const domainMatch = senderEmail.match(/@([^>]+)/);
      const senderDomain = domainMatch ? domainMatch[1].trim() : 'unknown';

      return {
        subject,
        senderName,
        senderEmail,
        senderDomain,
        replyTo,
        date,
        bodyText: bodyText.substring(0, 6000), // Cap at 6000 chars
        links: links.slice(0, 50),             // Cap at 50 links
        attachments,
        success: true
      };

    } catch (err) {
      return {
        error: 'EXTRACTION_FAILED',
        message: 'Could not read email data: ' + err.message
      };
    }
  }

  // ── Message listener ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractEmail') {
      const result = extractCurrentEmail();
      sendResponse(result);
    }
    if (request.action === 'ping') {
      sendResponse({ alive: true });
    }
    return true; // Keep channel open for async
  });

})();
