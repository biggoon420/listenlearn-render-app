import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const MAX_SOURCES = Number(process.env.MAX_SOURCES || 4);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const TRUSTED_EXACT_DOMAINS = new Set([
  'nih.gov', 'ncbi.nlm.nih.gov', 'who.int', 'cdc.gov', 'nasa.gov', 'noaa.gov',
  'britannica.com', 'stanford.edu', 'harvard.edu', 'mit.edu', 'yale.edu', 'princeton.edu',
  'ox.ac.uk', 'cam.ac.uk', 'nature.com', 'science.org', 'cell.com', 'thelancet.com',
  'quantamagazine.org', 'scientificamerican.com', 'reuters.com', 'apnews.com', 'bbc.com',
  'npr.org', 'theconversation.com', 'smithsonianmag.com', 'nationalgeographic.com',
  'developer.mozilla.org', 'docs.python.org', 'swift.org', 'developer.apple.com',
  'ableton.com', 'soundonsound.com', 'reverb.com', 'attackmagazine.com'
]);

const BLOCKED_DOMAINS = [
  'reddit.com', 'quora.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com',
  'facebook.com', 'x.com', 'twitter.com', 'pinterest.com', 'linkedin.com', 'amazon.com',
  'ebay.com', 'fandom.com', 'answers.com', 'slideshare.net'
];


function cleanText(text = '') {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
}


function removeExtractionNoise(document) {
  const noisySelectors = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'form',
    'nav', 'footer', 'header', 'aside', '[hidden]', '[aria-hidden="true"]',
    '.ad', '.ads', '.advert', '.advertisement', '[class*="ad-slot"]', '[id*="ad-slot"]',
    '[class*="cookie"]', '[id*="cookie"]', '[class*="newsletter"]', '[class*="promo"]'
  ];

  for (const node of document.querySelectorAll(noisySelectors.join(','))) {
    node.remove();
  }
}

function looksLikeCssDump(text = '') {
  const sample = cleanText(text).slice(0, 5000).toLowerCase();
  if (!sample) return false;

  const cssSignals = [
    '@media', 'font-family', 'background-color', 'grid-template', 'display:flex',
    'webkit-', 'moz-', 'ms-flex', '--source-text-decoration', 'ad-slot', '.dcr-',
    'border-radius', 'box-sizing:border-box', 'transform:translate'
  ];

  const signalCount = cssSignals.filter((signal) => sample.includes(signal)).length;
  const punctuationCount = (sample.match(/[{};]/g) || []).length;
  const wordCount = sample.split(/\s+/).filter(Boolean).length || 1;
  const punctuationRatio = punctuationCount / wordCount;

  return signalCount >= 3 || punctuationCount > 140 || punctuationRatio > 1.2;
}

function metaContent(document, selector) {
  return cleanText(document.querySelector(selector)?.getAttribute('content') || '');
}

function hostnameFromUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host;
  } catch {
    return '';
  }
}

function isHttpUrl(value = '') {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function articleQuestionFromUrl(url) {
  return `Summarize this article directly and explain the important parts without adding unrelated background: ${url}`;
}

function rootDomain(host) {
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // Handle common UK academic/government style domains roughly.
  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');
  if (['ac.uk', 'gov.uk', 'co.uk'].includes(lastTwo)) return lastThree;
  return lastTwo;
}

function isBlocked(host) {
  return BLOCKED_DOMAINS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function credibilityScore(result) {
  const host = hostnameFromUrl(result.url);
  const root = rootDomain(host);
  let score = 0;

  if (!host || isBlocked(host)) return -100;
  if (TRUSTED_EXACT_DOMAINS.has(host) || TRUSTED_EXACT_DOMAINS.has(root)) score += 8;
  if (host.endsWith('.gov') || host.includes('.gov.')) score += 6;
  if (host.endsWith('.edu') || host.includes('.edu.')) score += 6;
  if (host.endsWith('.ac.uk')) score += 6;
  if (host.endsWith('.org')) score += 2;
  if (/journal|research|study|university|institute|official|guide/i.test(`${result.title} ${result.description}`)) score += 2;
  if (/sponsored|affiliate|buy now|coupon|top 10|best .+ 202\d/i.test(`${result.title} ${result.description}`)) score -= 3;
  if (/wikipedia\.org$/.test(host)) score -= 1; // useful overview, but not ideal as a main source

  return score;
}

function normalizeBraveResult(r) {
  return {
    title: cleanText(r.title || 'Untitled source'),
    url: r.url,
    description: cleanText(r.description || r.extra_snippets?.join(' ') || ''),
    age: r.age || null,
    language: r.language || null,
    domain: hostnameFromUrl(r.url)
  };
}

async function braveSearch(question) {
  if (!process.env.BRAVE_API_KEY) {
    throw new Error('Missing BRAVE_API_KEY. Add it in Render environment variables.');
  }

  const query = `${question} reputable source article research explanation`;
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('safesearch', 'moderate');
  url.searchParams.set('text_decorations', 'false');
  url.searchParams.set('spellcheck', 'true');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': process.env.BRAVE_API_KEY
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave Search failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const rawResults = data?.web?.results || [];
  const seenDomains = new Set();

  return rawResults
    .map(normalizeBraveResult)
    .map((result) => ({ ...result, score: credibilityScore(result) }))
    .filter((result) => result.url && result.score > -20)
    .sort((a, b) => b.score - a.score)
    .filter((result) => {
      const root = rootDomain(result.domain);
      if (seenDomains.has(root)) return false;
      seenDomains.add(root);
      return true;
    })
    .slice(0, Math.max(MAX_SOURCES + 2, 6));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractArticle(candidate) {
  try {
    const response = await fetchWithTimeout(candidate.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ListenLearnBot/1.0; +https://example.com/bot)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      throw new Error(`Not usable HTML: ${response.status}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html, { url: candidate.url });
    const document = dom.window.document;
    removeExtractionNoise(document);

    const fallbackTitle =
      metaContent(document, 'meta[property="og:title"]') ||
      cleanText(document.querySelector('title')?.textContent || '') ||
      candidate.title;

    const fallbackDescription =
      metaContent(document, 'meta[name="description"]') ||
      metaContent(document, 'meta[property="og:description"]') ||
      candidate.description;

    const reader = new Readability(document);
    const article = reader.parse();
    let text = cleanText(article?.textContent || '');

    // Some pages, especially aggressively styled news sites, can leak their CSS
    // into extracted text. Never send that garbage to the summarizer.
    if (looksLikeCssDump(text)) {
      text = '';
    }

    const hasFullText = text.length > 900;
    const excerpt = hasFullText ? text.slice(0, 9000) : cleanText(fallbackDescription);

    return {
      ...candidate,
      readableTitle: cleanText(article?.title || fallbackTitle || candidate.title),
      byline: cleanText(article?.byline || ''),
      excerpt,
      fetched: hasFullText,
      wordCountEstimate: Math.round((hasFullText ? text : excerpt).split(/\s+/).filter(Boolean).length)
    };
  } catch {
    return {
      ...candidate,
      readableTitle: candidate.title,
      byline: '',
      excerpt: cleanText(candidate.description),
      fetched: false,
      wordCountEstimate: Math.round(cleanText(candidate.description).split(/\s+/).filter(Boolean).length)
    };
  }
}

async function extractArticleUrl(articleUrl) {
  const url = cleanText(articleUrl);
  if (!isHttpUrl(url)) {
    throw new Error('That does not look like a valid article URL.');
  }

  const host = hostnameFromUrl(url);
  if (!host || isBlocked(host)) {
    throw new Error('That URL is from a blocked or unsupported site. Try the original article link instead.');
  }

  const article = await extractArticle({
    title: host,
    url,
    description: '',
    age: null,
    language: null,
    domain: host,
    score: credibilityScore({ title: host, description: '', url })
  });

  if (!article.fetched || cleanText(article.excerpt).length < 500) {
    throw new Error('I could not read enough of that article. It may be paywalled, login-only, or blocking article extraction.');
  }

  return article;
}

function readingStyle(length) {
  if (length === 'quick') return 'Very concise: about 90 seconds of listening.';
  if (length === 'deep') return 'Detailed but direct: about 2 to 3 minutes of listening. Do not pad with background unless the question requires it.';
  return 'Balanced: about 2 to 3 minutes of listening.';
}

const summarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answerTitle: { type: 'string' },
    shortAnswer: { type: 'string' },
    keyTakeaways: {
      type: 'array',
      minItems: 3,
      maxItems: 6,
      items: { type: 'string' }
    },
    sourceSummaries: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceNumber: { type: 'integer' },
          whyGood: { type: 'string' },
          summary: { type: 'string' },
          readThisFor: { type: 'string' }
        },
        required: ['sourceNumber', 'whyGood', 'summary', 'readThisFor']
      }
    },
    listenScript: { type: 'string' }
  },
  required: ['answerTitle', 'shortAnswer', 'keyTakeaways', 'sourceSummaries', 'listenScript']
};
function extractResponsesText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('');
}

async function callOpenAIResponses(payload) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI Responses API failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return response.json();
}

async function summarizeWithOpenAI(question, articles, length) {
  const model = process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini';
  const compactArticles = articles.map((a, index) => ({
    sourceNumber: index + 1,
    title: a.readableTitle || a.title,
    url: a.url,
    domain: a.domain,
    byline: a.byline,
    searchSnippet: a.description,
    extractedText: a.excerpt,
    fetchedFullArticle: a.fetched
  }));

  const data = await callOpenAIResponses({
    model,
    input: [
      {
        role: 'system',
        content: [
          'You are a careful educational research assistant for a learning app.',
          'Use only the provided sources. Do not invent URLs, titles, citations, or claims.',
          'Tailor the explanation directly to the user question.',
          'If the user asks a direct question, answer it immediately in the first sentence. Do not open with generic background, history, definitions, or setup unless needed to answer.',
          'The answer can be thoughtful and useful, but it should get to the point. No filler, no throat-clearing, no textbook intro.',
          'Do not put “Quick answer,” “Short answer,” “Background,” or similar labels in answerTitle, shortAnswer, keyTakeaways, or listenScript.',
          'answerTitle should be a clean title based on the actual answer, not a meta label and not a parenthetical like “(quick answer)”.',
          'Do not include follow-up questions or a next-questions section.',
          'Prefer clear explanation over hype. Explain uncertainty when the sources are weak.',
          'Do not quote more than a few words from any source. Summarize in your own words.',
          'The listenScript should sound like a calm, interesting human tutor, not a robotic essay. Keep it natural and concise.'
        ].join(' ')
      },
      {
        role: 'user',
        content: JSON.stringify({
          question,
          listeningLength: readingStyle('deep'),
          sources: compactArticles
        })
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'research_summary',
        strict: true,
        schema: summarySchema
      }
    }
  });

  const raw = extractResponsesText(data);
  if (!raw) throw new Error('OpenAI returned an empty summary.');
  const parsed = JSON.parse(raw);
  parsed.answerTitle = cleanText(parsed.answerTitle)
    .replace(/\s*\((quick|short) answer\)\s*/gi, '')
    .replace(/^(quick answer|short answer|background)\s*:?\s*/i, '')
    .trim();

  // Make links deterministic: never trust the model to write or modify URLs.
  parsed.sourceSummaries = parsed.sourceSummaries
    .map((s) => {
      const original = articles[s.sourceNumber - 1];
      if (!original) return null;
      return {
        ...s,
        title: original.readableTitle || original.title,
        url: original.url,
        domain: original.domain
      };
    })
    .filter(Boolean);

  return parsed;
}

function trimForSpeech(text) {
  const cleaned = cleanText(text);
  if (cleaned.length <= 3900) return cleaned;
  return `${cleaned.slice(0, 3850)}...`;
}

async function makeSpeech(text) {
  const voice = 'marin';
  const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      voice,
      input: trimForSpeech(text),
      instructions: 'Speak like a calm, smart friend explaining something directly. Natural pacing, not salesy, not overexcited, no fake radio voice. Skip dramatic emphasis. Pause slightly between sections.',
      response_format: 'mp3'
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI speech failed: ${response.status} ${errorText.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    voice,
    mimeType: 'audio/mpeg',
    dataUrl: `data:audio/mpeg;base64,${buffer.toString('base64')}`
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/article', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY. Add it in Render environment variables.' });
    }

    const articleUrl = cleanText(req.body?.url || '');
    const includeAudio = true;

    const article = await extractArticleUrl(articleUrl);
    const summary = await summarizeWithOpenAI(articleQuestionFromUrl(articleUrl), [article], 'deep');
    const audio = includeAudio ? await makeSpeech(summary.listenScript) : null;

    res.json({
      question: articleUrl,
      generatedAt: new Date().toISOString(),
      articleCount: 1,
      summary,
      audio,
      disclosure: 'The spoken narration is AI-generated, not a human recording.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || 'Something went wrong while reading this article.'
    });
  }
});

app.post('/api/learn', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY. Add it in Render environment variables.' });
    }

    const question = cleanText(req.body?.question || '');
    const length = 'deep';
    const includeAudio = true;

    if (question.length < 3) {
      return res.status(400).json({ error: 'Ask a real question or topic first.' });
    }
    if (question.length > 350) {
      return res.status(400).json({ error: 'Question is too long. Keep it under 350 characters.' });
    }

    const candidates = await braveSearch(question);
    const extracted = await Promise.all(candidates.map(extractArticle));
    const articles = extracted
      .filter((a) => cleanText(a.excerpt).length > 120 && !looksLikeCssDump(a.excerpt))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SOURCES);

    if (articles.length === 0) {
      return res.status(502).json({ error: 'I found search results, but none had enough readable text to summarize safely.' });
    }

    const summary = await summarizeWithOpenAI(question, articles, length);
    const audio = includeAudio ? await makeSpeech(summary.listenScript) : null;

    res.json({
      question,
      generatedAt: new Date().toISOString(),
      articleCount: articles.length,
      summary,
      audio,
      disclosure: 'The spoken narration is AI-generated, not a human recording.'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || 'Something went wrong while researching this topic.'
    });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`ListenLearn running on http://${HOST}:${PORT}`);
});
