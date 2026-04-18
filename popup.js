// AI-SPAM Popup Controller

(function () {
  'use strict';

  // ── DOM references ───────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  const btnScan        = $('btnScan');
  const btnSettings    = $('btnSettings');
  const settingsPanel  = $('settingsPanel');
  const noKeyBanner    = $('noKeyBanner');
  const emailPreview   = $('emailPreview');
  const gmailStatus    = $('gmailStatus');
  const gmailIndicator = $('gmailIndicator');
  const errorBanner    = $('errorBanner');
  const errorText      = $('errorText');
  const resultsSection = $('resultsSection');
  const tipsSection    = $('tipsSection');
  const progressWrap   = $('progressWrap');
  const progressBar    = $('progressBar');
  const keySavedMsg    = $('keySavedMsg');
  const serverStatus   = $('serverStatus');

  // State
  let currentEmailData = null;

  // ── Server status ping ──────────────────────────────────────────────────────
  async function pingServer() {
    if (!serverStatus) return;
    try {
      const res = await chrome.runtime.sendMessage({ action: 'checkServer' });
      if (res && res.online) {
        serverStatus.textContent = '🟢 Server Online';
        serverStatus.style.color = '#15803d';
      } else {
        serverStatus.textContent = '🔴 Server Offline';
        serverStatus.style.color = '#be123c';
      }
    } catch (_) {
      serverStatus.textContent = '🔴 Server Unreachable';
      serverStatus.style.color = '#be123c';
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    // Load saved API key
    // Keys live on server — nothing to load from storage

    // Ping server status
    pingServer();

    // Check which tab is active
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || !tab.url || !tab.url.includes('mail.google.com')) {
      setGmailStatus('not-gmail', 'Not on Gmail — open Gmail to use this scanner.');
      return;
    }

    // Try to ping content script
    try {
      const ping = await sendToContent(tab.id, { action: 'ping' });
      if (!ping || !ping.alive) throw new Error('not alive');
    } catch (e) {
      // Content script might not be injected yet, inject manually
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
      } catch (injectErr) {
        // Already injected or another error
      }
    }

    // Try to get email preview
    await refreshEmailPreview(tab.id);
  }

  // ── Gmail status ─────────────────────────────────────────────────────────────
  function setGmailStatus(state, message) {
    gmailStatus.innerHTML = message;
    gmailIndicator.className = 'gmail-indicator';

    if (state === 'detected') {
      gmailIndicator.classList.add('detected');
      emailPreview.classList.add('visible');
      btnScan.disabled = false;
    } else if (state === 'no-email') {
      gmailIndicator.classList.add('no-email');
    }

    // No key check — server-backed
  }

  // ── Refresh email preview ────────────────────────────────────────────────────
  async function refreshEmailPreview(tabId) {
    try {
      const data = await sendToContent(tabId, { action: 'extractEmail' });

      if (data.error === 'NO_EMAIL_OPEN') {
        setGmailStatus('no-email', '<strong>Gmail detected</strong> — please open an email to scan it.');
        return;
      }

      if (data.error) {
        setGmailStatus('no-email', 'Could not read email: ' + data.message);
        return;
      }

      currentEmailData = data;
      setGmailStatus('detected', '<strong>Gmail detected</strong> — email ready to scan.');

      $('previewSubject').textContent = truncate(data.subject, 45);
      $('previewSender').textContent = truncate(data.senderEmail, 30);
      $('previewDomain').textContent = data.senderDomain || 'unknown';

    } catch (err) {
      setGmailStatus('no-email', 'Error accessing Gmail page: ' + err.message);
    }
  }

  // ── Scan button ──────────────────────────────────────────────────────────────
  btnScan.addEventListener('click', async () => {
    // No key check needed — server handles auth

    if (!currentEmailData) {
      showError('No email detected. Please open an email in Gmail first.');
      return;
    }

    await runScan();
  });

  // ── Run scan ─────────────────────────────────────────────────────────────────
  async function runScan() {
    // UI: scanning state
    setScanningState(true);
    hideError();
    hideResults();
    animateProgress();

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'analyzeEmail',
        emailData: currentEmailData,
      });

      finishProgress();

      if (!response || !response.success) {
        throw new Error(response?.error || 'Unknown error from background script.');
      }

      renderResults(response.result, currentEmailData);

    } catch (err) {
      finishProgress();
      showError('Scan failed: ' + err.message);
    } finally {
      setScanningState(false);
    }
  }

  // ── Render results ───────────────────────────────────────────────────────────
  function renderResults(result, emailData) {
    const status = (result.status || 'SUSPICIOUS').toUpperCase();
    const statusClass = status === 'SAFE' ? 'safe' : status === 'UNSAFE' ? 'unsafe' : 'suspicious';
    const statusEmoji = status === 'SAFE' ? '✅' : status === 'UNSAFE' ? '🚨' : '⚠️';

    // Status card
    const card = $('statusCard');
    card.className = 'status-card ' + statusClass;

    const badge = $('statusBadge');
    badge.className = 'status-badge-large ' + statusClass;
    badge.textContent = statusEmoji + ' ' + status;

    const score = result.riskScore ?? 0;
    const scoreEl = $('riskScore');
    scoreEl.className = 'risk-score ' + statusClass;
    scoreEl.textContent = 'RISK: ' + score + '/100';

    $('resultSubject').textContent = truncate(emailData.subject, 40);
    $('resultSender').textContent = emailData.senderEmail || 'Unknown';

    // Threat tags
    const tagsEl = $('threatTags');
    tagsEl.innerHTML = '';
    const threats = result.threatTypes || [];
    if (threats.length > 0) {
      threats.forEach(t => {
        const tag = document.createElement('span');
        tag.className = 'threat-tag';
        tag.textContent = t;
        tagsEl.appendChild(tag);
      });
    } else {
      const tag = document.createElement('span');
      tag.className = 'threat-tag';
      tag.style.background = 'rgba(0,255,136,0.08)';
      tag.style.borderColor = 'rgba(0,255,136,0.15)';
      tag.style.color = 'var(--green)';
      tag.textContent = 'No Threats Detected';
      tagsEl.appendChild(tag);
    }

    // Risk summary
    $('riskSummary').textContent = result.riskSummary || result.verdict || '—';

    // Suspicious elements
    const susList = result.suspiciousElements || [];
    if (susList.length > 0) {
      $('panelSuspicious').style.display = 'block';
      $('countSuspicious').textContent = susList.length;
      const body = $('bodySuspicious');
      body.innerHTML = susList.map(el => `
        <div class="sus-item">
          <span class="sus-type">${esc(el.type || 'FLAG').toUpperCase()}</span>
          <div class="sus-content">
            <div class="sus-value">${esc(el.value || '—')}</div>
            <div class="sus-reason">${esc(el.reason || '')}</div>
          </div>
        </div>
      `).join('');
    }

    // Link analysis
    const linkList = (result.linkAnalysis || []).filter(l => l.url);
    if (linkList.length > 0) {
      $('panelLinks').style.display = 'block';
      $('countLinks').textContent = linkList.length;
      const body = $('bodyLinks');
      body.innerHTML = linkList.map(l => `
        <div class="link-item">
          <div class="link-header">
            <span class="link-risk ${(l.risk || 'safe').toLowerCase()}">${esc((l.risk || 'safe').toUpperCase())}</span>
            <span class="link-anchor">${esc(l.anchorText || l.url)}</span>
          </div>
          <div class="link-url">${esc(l.url)}</div>
          <div class="link-reason">${esc(l.reason || '')}</div>
        </div>
      `).join('');
    }

    // Security tips
    const tips = result.securityTips || [];
    if (tips.length > 0) {
      tipsSection.style.display = 'block';
      $('tipsBody').innerHTML = tips.map((t, i) => `
        <div class="tip-item">
          <span class="tip-num">${i + 1}.</span>
          <span>${esc(t)}</span>
        </div>
      `).join('');
    }

    // Show results
    resultsSection.classList.add('visible');

    // Scroll to results
    setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  // ── Progress animation ───────────────────────────────────────────────────────
  let progressInterval;

  function animateProgress() {
    progressWrap.classList.add('visible');
    let w = 0;
    progressInterval = setInterval(() => {
      if (w < 85) { w += Math.random() * 8; w = Math.min(w, 85); }
      progressBar.style.width = w + '%';
    }, 300);
  }

  function finishProgress() {
    clearInterval(progressInterval);
    progressBar.style.width = '100%';
    setTimeout(() => {
      progressWrap.classList.remove('visible');
      progressBar.style.width = '0%';
    }, 600);
  }

  // ── Scanning state ───────────────────────────────────────────────────────────
  function setScanningState(scanning) {
    btnScan.disabled = scanning;
    if (scanning) {
      btnScan.classList.add('scanning');
    } else {
      btnScan.classList.remove('scanning');
    }
  }

  // ── Error handling ───────────────────────────────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorBanner.classList.add('visible');
    setTimeout(() => errorBanner.classList.remove('visible'), 8000);
  }

  function hideError() {
    errorBanner.classList.remove('visible');
  }

  function hideResults() {
    resultsSection.classList.remove('visible');
    tipsSection.style.display = 'none';
    $('panelSuspicious').style.display = 'none';
    $('panelLinks').style.display = 'none';
  }

  // ── Settings panel ───────────────────────────────────────────────────────────
  btnSettings.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
  });

  // No API keys needed — server handles everything
  function showKeySaved() {
    keySavedMsg.style.display = 'flex';
    setTimeout(() => { keySavedMsg.style.display = 'none'; }, 3000);
  }

  // ── Collapsible panels ───────────────────────────────────────────────────────
  function setupToggle(toggleId, bodyId) {
    const btn = $(toggleId);
    const body = $(bodyId);
    if (!btn || !body) return;
    btn.addEventListener('click', () => {
      const open = body.classList.toggle('open');
      btn.classList.toggle('open', open);
    });
  }

  setupToggle('toggleSuspicious', 'bodySuspicious');
  setupToggle('toggleLinks', 'bodyLinks');

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function truncate(str, max) {
    if (!str) return '—';
    return str.length > max ? str.substring(0, max) + '…' : str;
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sendToContent(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();
