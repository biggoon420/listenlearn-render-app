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

async function askQuestion() {
  const question = questionEl.value.trim();
  if (!question) {
    setStatus('Type a topic or question first.', true);
    return;
  }

  clearResult();
  askButton.disabled = true;
  let statusIndex = 0;
  setStatus(statusMessages[statusIndex]);

  const interval = setInterval(() => {
    statusIndex = Math.min(statusIndex + 1, statusMessages.length - 1);
    setStatus(statusMessages[statusIndex]);
  }, 3000);

  try {
    const response = await fetch('/api/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');

    setStatus(`Done. Used ${data.articleCount} source${data.articleCount === 1 ? '' : 's'}.`);
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {});
  });
}
