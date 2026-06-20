const questionEl = document.querySelector('#question');
const askButton = document.querySelector('#askButton');
const statusEl = document.querySelector('#status');
const resultEl = document.querySelector('#result');

const statusMessages = [
  'Finding solid sources...',
  'Reading the strongest results...',
  'Cutting it down to the useful parts...',
  'Making the audio...'
];

const articleStatusMessages = [
  'Reading the article...',
  'Finding the useful parts...',
  'Summarizing it clearly...',
  'Making the audio...'
];

function isHttpUrl(value = '') {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getSharedArticleUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('article') || '';
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatus(message, isError = false) {
  statusEl.classList.remove('hidden');
  statusEl.classList.toggle('error', isError);
  statusEl.textContent = message;
}

function clearResult() {
  resultEl.classList.add('hidden');
  resultEl.innerHTML = '';
}

function renderResult(data) {
  const summary = data.summary;

  const takeaways = (summary.keyTakeaways || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('');

  const links = (summary.sourceSummaries || [])
    .map((source) => `
      <a class="source-pill" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">
        <span>${escapeHtml(source.domain)}</span>
        <b>${escapeHtml(source.title)}</b>
      </a>
    `)
    .join('');

  const audioHtml = data.audio?.dataUrl
    ? `
      <div class="audio-row">
        <audio controls src="${data.audio.dataUrl}"></audio>
        <p>AI-generated narration.</p>
      </div>
    `
    : '';

  resultEl.innerHTML = `
    <div class="overview-card">
      <p class="label">Overview</p>
      <h2>${escapeHtml(summary.answerTitle)}</h2>
      <p class="answer">${escapeHtml(summary.shortAnswer)}</p>
      ${takeaways ? `<ul>${takeaways}</ul>` : ''}
      ${audioHtml}
      ${links ? `<div class="source-links">${links}</div>` : ''}
    </div>
  `;
  resultEl.classList.remove('hidden');
}

async function askQuestion(inputOverride = '') {
  const question = (inputOverride || questionEl.value).trim();
  if (!question) {
    setStatus('Type a topic, question, or article link first.', true);
    return;
  }

  const articleMode = isHttpUrl(question);
  const messages = articleMode ? articleStatusMessages : statusMessages;

  clearResult();
  askButton.disabled = true;
  let statusIndex = 0;
  setStatus(messages[statusIndex]);

  const interval = setInterval(() => {
    statusIndex = Math.min(statusIndex + 1, messages.length - 1);
    setStatus(messages[statusIndex]);
  }, 3000);

  try {
    const response = await fetch(articleMode ? '/api/article' : '/api/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(articleMode ? { url: question } : { question })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');

    setStatus(articleMode ? 'Done. Read 1 article.' : `Done. Used ${data.articleCount} source${data.articleCount === 1 ? '' : 's'}.`);
    renderResult(data);
  } catch (error) {
    setStatus(error.message || 'Something went wrong.', true);
  } finally {
    clearInterval(interval);
    askButton.disabled = false;
  }
}

askButton.addEventListener('click', askQuestion);
questionEl.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    askQuestion();
  }
});

const sharedArticleUrl = getSharedArticleUrl();
if (sharedArticleUrl && isHttpUrl(sharedArticleUrl)) {
  questionEl.value = sharedArticleUrl;
  window.history.replaceState({}, document.title, window.location.pathname);
  askQuestion(sharedArticleUrl);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {});
  });
}
