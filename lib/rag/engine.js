/**
 * CrossX Advanced RAG Engine
 *
 * Architecture:
 *   - Hybrid Search: BM25 (sparse/keyword) + cosine similarity on OpenAI embeddings (dense)
 *   - RBAC: audience-level partition (b2c vs b2b) enforced before any retrieval
 *   - Metadata pre-filtering: target_country, source_country, category, language
 *   - Re-ranking: simple cross-score combining BM25 + cosine scores
 *   - Strict grounding: generation prompt forces LLM to cite sources only
 *   - Citation: doc_id returned in every response
 *
 * Storage: JSON flat file (lib/rag/embeddings-store.json) acts as the vector DB.
 * Embeddings are generated via OpenAI text-embedding-3-small and cached.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORE_PATH = path.join(__dirname, "embeddings-store.json");
const DOCS_DIR = path.join(__dirname, "../knowledge/docs");

let _store = null; // { chunks: [...], embeddingsMap: { chunkId: [float...] } }

function loadStore() {
  if (_store) return _store;
  if (fs.existsSync(STORE_PATH)) {
    try {
      _store = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    } catch {
      _store = { chunks: [], embeddingsMap: {} };
    }
  } else {
    _store = { chunks: [], embeddingsMap: {} };
  }
  return _store;
}

function saveStore() {
  if (!_store) return;
  fs.writeFileSync(STORE_PATH, JSON.stringify(_store), "utf8");
}

// ---------------------------------------------------------------------------
// Markdown parser & chunker (header-based semantic chunking)
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from a Markdown string.
 * Returns { metadata: {}, content: string }
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, content: raw };
  const yamlStr = match[1];
  const content = match[2];
  const metadata = {};
  for (const line of yamlStr.split("\n")) {
    const kv = line.match(/^(\w[\w_-]*):\s*"?([^"]*)"?\s*$/);
    if (kv) metadata[kv[1].trim()] = kv[2].trim();
  }
  return { metadata, content };
}

/**
 * Split Markdown content into semantic chunks based on header levels.
 * Each chunk inherits parent header context.
 * Returns array of { content, headers: { H1, H2, H3 } }
 */
function chunkMarkdownByHeaders(content) {
  const lines = content.split("\n");
  const chunks = [];
  let currentHeaders = { H1: "", H2: "", H3: "" };
  let currentLines = [];

  function flushChunk() {
    const text = currentLines.join("\n").trim();
    if (text.length > 20) {
      chunks.push({
        content: text,
        headers: { ...currentHeaders },
        // Build a readable heading path for the chunk
        headingPath: [currentHeaders.H1, currentHeaders.H2, currentHeaders.H3]
          .filter(Boolean)
          .join(" > "),
      });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);

    if (h1) {
      flushChunk();
      currentHeaders = { H1: h1[1].trim(), H2: "", H3: "" };
      currentLines.push(line);
    } else if (h2) {
      flushChunk();
      currentHeaders = { ...currentHeaders, H2: h2[1].trim(), H3: "" };
      currentLines.push(line);
    } else if (h3) {
      flushChunk();
      currentHeaders = { ...currentHeaders, H3: h3[1].trim() };
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }
  }
  flushChunk();

  // Secondary split: if any chunk > 1200 chars, split by double-newline
  const result = [];
  for (const chunk of chunks) {
    if (chunk.content.length <= 1200) {
      result.push(chunk);
    } else {
      const parts = chunk.content.split(/\n\n+/);
      let buffer = "";
      for (const part of parts) {
        if ((buffer + "\n\n" + part).length > 1200 && buffer) {
          result.push({ ...chunk, content: buffer.trim() });
          buffer = part;
        } else {
          buffer = buffer ? buffer + "\n\n" + part : part;
        }
      }
      if (buffer.trim()) result.push({ ...chunk, content: buffer.trim() });
    }
  }
  return result;
}

/**
 * Ingest a single Markdown file into the store.
 * Returns number of chunks added.
 */
async function ingestMarkdownFile(filePath, openaiApiKey) {
  const raw = fs.readFileSync(filePath, "utf8");
  const { metadata, content } = parseFrontmatter(raw);

  if (!metadata.doc_id) {
    console.warn(`[RAG] No doc_id in ${filePath}, skipping.`);
    return 0;
  }

  const store = loadStore();

  // Remove existing chunks for this doc_id (re-ingest)
  store.chunks = store.chunks.filter((c) => c.docId !== metadata.doc_id);
  for (const id of Object.keys(store.embeddingsMap)) {
    if (id.startsWith(`${metadata.doc_id}::`)) delete store.embeddingsMap[id];
  }

  const rawChunks = chunkMarkdownByHeaders(content);
  let added = 0;

  for (let i = 0; i < rawChunks.length; i++) {
    const rc = rawChunks[i];
    const chunkId = `${metadata.doc_id}::${i}`;
    const chunkText = rc.headingPath ? `[${rc.headingPath}]\n${rc.content}` : rc.content;

    // Generate embedding
    let embedding = null;
    if (openaiApiKey) {
      try {
        embedding = await generateEmbedding(chunkText, openaiApiKey);
      } catch (e) {
        console.warn(`[RAG] Embedding failed for ${chunkId}: ${e.message}`);
      }
    }

    store.chunks.push({
      chunkId,
      docId: metadata.doc_id,
      content: chunkText,
      rawContent: rc.content,
      headingPath: rc.headingPath,
      metadata: { ...metadata },
    });

    if (embedding) {
      store.embeddingsMap[chunkId] = embedding;
    }

    added++;
  }

  saveStore();
  return added;
}

/**
 * Ingest all .md files from DOCS_DIR.
 */
async function ingestAllDocs(openaiApiKey) {
  if (!fs.existsSync(DOCS_DIR)) return 0;
  const files = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  let total = 0;
  for (const f of files) {
    const n = await ingestMarkdownFile(path.join(DOCS_DIR, f), openaiApiKey);
    total += n;
    console.log(`[RAG] Ingested ${f}: ${n} chunks`);
  }
  console.log(`[RAG] Total chunks: ${total}`);
  return total;
}

// ---------------------------------------------------------------------------
// Embeddings via OpenAI API
// ---------------------------------------------------------------------------

async function generateEmbedding(text, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) });
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/embeddings",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.data && parsed.data[0] && parsed.data[0].embedding) {
              resolve(parsed.data[0].embedding);
            } else {
              reject(new Error(parsed.error?.message || "No embedding returned"));
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// BM25 (sparse keyword retrieval)
// ---------------------------------------------------------------------------

function tokenize(text) {
  const str = String(text || "").toLowerCase();
  const tokens = [];
  // For CJK characters: extract bigrams (2-character n-grams) to improve matching
  // For Latin/numeric words: use whole words
  const cjkPattern = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/;
  let i = 0;
  // First pass: split into Latin words and CJK runs
  const parts = str.split(/([^\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+)/);
  for (const part of parts) {
    if (!part) continue;
    if (cjkPattern.test(part)) {
      // CJK run: add unigrams (length>=1) and bigrams
      const chars = [...part.replace(/\s/g, "")];
      for (const c of chars) {
        if (c.length >= 1) tokens.push(c);
      }
      for (let j = 0; j < chars.length - 1; j++) {
        tokens.push(chars[j] + chars[j + 1]);
      }
    } else {
      // Latin/numeric: split on whitespace/punctuation, keep words >=2 chars
      const words = part.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 2);
      tokens.push(...words);
    }
  }
  return tokens;
}

/**
 * Compute BM25 score for a query against a document.
 * k1=1.5, b=0.75 — standard BM25 parameters.
 */
function bm25Score(queryTokens, docTokens, avgDocLen, corpusSize, docFreqMap) {
  const k1 = 1.5;
  const b = 0.75;
  const docLen = docTokens.length;
  const termFreq = {};
  for (const t of docTokens) termFreq[t] = (termFreq[t] || 0) + 1;

  let score = 0;
  for (const q of queryTokens) {
    const tf = termFreq[q] || 0;
    if (tf === 0) continue;
    const df = docFreqMap[q] || 0;
    const idf = Math.log((corpusSize - df + 0.5) / (df + 0.5) + 1);
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLen / avgDocLen));
    score += idf * (numerator / denominator);
  }
  return score;
}

// ---------------------------------------------------------------------------
// Cosine similarity (dense retrieval)
// ---------------------------------------------------------------------------

function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// RBAC + Metadata Filtering
// ---------------------------------------------------------------------------

/**
 * Apply pre-retrieval metadata filters.
 * Enforces RBAC: a b2c session can NEVER see b2b chunks.
 */
function applyMetadataFilter(chunks, filters) {
  const { audience, target_country, source_country, category, language } = filters || {};

  return chunks.filter((chunk) => {
    const m = chunk.metadata || {};

    // RBAC: strict audience enforcement
    if (audience === "b2c" && m.audience === "b2b") return false;
    if (audience && m.audience && m.audience !== audience) return false;

    // Optional filters (only apply if specified in filter)
    if (target_country && m.target_country && !m.target_country.toLowerCase().includes(target_country.toLowerCase())) return false;
    if (source_country && m.source_country && !m.source_country.toLowerCase().includes(source_country.toLowerCase())) return false;
    if (category && m.category && m.category !== category) return false;
    if (language && m.language && !m.language.startsWith(language)) return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// Hybrid Retrieval
// ---------------------------------------------------------------------------

/**
 * Main retrieval function.
 *
 * @param {string} query - The user's query text
 * @param {object} options
 *   - audience: "b2c" | "b2b"  (required for RBAC)
 *   - target_country: string
 *   - source_country: string
 *   - category: string
 *   - language: string
 *   - topK: number (default 4)
 *   - openaiApiKey: string (for query embedding; omit for BM25-only)
 *   - bm25Weight: number 0-1 (default 0.4)
 * @returns {Array<{ chunkId, docId, content, metadata, score, source }>}
 */
async function retrieve(query, options = {}) {
  const store = loadStore();
  const {
    audience = "b2c",
    topK = 4,
    openaiApiKey,
    bm25Weight = 0.4,
    target_country,
    source_country,
    category,
    language,
  } = options;

  // Step 1: RBAC + metadata pre-filter
  const candidates = applyMetadataFilter(store.chunks, {
    audience,
    target_country,
    source_country,
    category,
    language,
  });

  if (candidates.length === 0) return [];

  // Step 2: BM25 scoring
  const queryTokens = tokenize(query);
  const docTokensList = candidates.map((c) => tokenize(c.content));
  const avgDocLen = docTokensList.reduce((s, d) => s + d.length, 0) / (docTokensList.length || 1);

  // Build document frequency map
  const docFreqMap = {};
  for (const tokens of docTokensList) {
    const seen = new Set(tokens);
    for (const t of seen) docFreqMap[t] = (docFreqMap[t] || 0) + 1;
  }

  const bm25Scores = candidates.map((_, i) =>
    bm25Score(queryTokens, docTokensList[i], avgDocLen, candidates.length, docFreqMap),
  );

  // Normalize BM25 scores to [0, 1]
  const maxBm25 = Math.max(...bm25Scores, 0.0001);
  const normalizedBm25 = bm25Scores.map((s) => s / maxBm25);

  // Step 3: Dense vector scoring (if embeddings available)
  let cosineScores = candidates.map(() => 0);
  if (openaiApiKey) {
    try {
      const queryEmbedding = await generateEmbedding(query, openaiApiKey);
      cosineScores = candidates.map((chunk) => {
        const emb = store.embeddingsMap[chunk.chunkId];
        return emb ? cosineSimilarity(queryEmbedding, emb) : 0;
      });
    } catch (e) {
      console.warn("[RAG] Dense retrieval failed, using BM25 only:", e.message);
    }
  }

  // Normalize cosine scores to [0, 1]
  const maxCosine = Math.max(...cosineScores, 0.0001);
  const normalizedCosine = cosineScores.map((s) => s / maxCosine);

  // Step 4: Hybrid score = BM25_weight * bm25 + (1 - BM25_weight) * cosine
  const denseWeight = 1 - bm25Weight;
  const hybridScores = candidates.map((_, i) =>
    bm25Weight * normalizedBm25[i] + denseWeight * normalizedCosine[i],
  );

  // Step 5: Sort and take top-K
  const ranked = candidates
    .map((chunk, i) => ({ ...chunk, score: hybridScores[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return ranked;
}

// ---------------------------------------------------------------------------
// Intent Routing (AC1)
// ---------------------------------------------------------------------------

const RAG_INTENT_PATTERNS = [
  // Policy & info questions
  /how (do|can|to|does)|what is|what are|where (do|can|can i)|when (do|can|is)|why (do|is)/i,
  /规定|政策|手续|指南|说明|如何|怎么|怎样|能否|什么是|哪些|多少钱|费用|限额|流程/,
  /visa|policy|guide|tutorial|how to|requirement|procedure|rule|regulation|fee|limit/i,
  /支付宝|微信支付|alipay|wechat pay|12306|didi|滴滴|护照|passport|transit|签证/i,
  /旅行建议|tips|advice|warning|注意|提醒|常见问题|faq/i,
];

const BOOKING_ACTION_PATTERNS = [
  /book|reserve|order|buy|purchase|ticket|hotel|预订|订酒店|订票|买票|打车|叫车/i,
  /find me|show me|get me|帮我找|给我推荐|搜索|查找/i,
];

/**
 * Classify whether the query needs RAG (knowledge retrieval)
 * or API Tool Execution (booking/action).
 * Returns "rag" | "action" | "both"
 */
function classifyIntent(query) {
  const text = String(query || "");
  const isRag = RAG_INTENT_PATTERNS.some((p) => p.test(text));
  const isAction = BOOKING_ACTION_PATTERNS.some((p) => p.test(text));

  if (isRag && !isAction) return "rag";
  if (isAction && !isRag) return "action";
  if (isRag && isAction) return "both";
  return "action"; // Default: treat as action query
}

// ---------------------------------------------------------------------------
// Generation (AC2 + AC3: strict grounding + citation)
// ---------------------------------------------------------------------------

const FALLBACK_RESPONSE = {
  ZH: "抱歉，我的知识库中暂时没有关于这个问题的具体信息。建议您通过官方渠道或联系客服获取最新资讯。",
  EN: "I don't have this specific information in my current knowledge base. Please check official channels or contact support for the latest details.",
  JA: "申し訳ありませんが、この件に関する具体的な情報は現在のナレッジベースには含まれておりません。",
  KO: "죄송합니다. 현재 지식 베이스에서 이 질문에 대한 구체적인 정보를 찾을 수 없습니다.",
};

/**
 * Build the strict grounding prompt for LLM generation.
 */
function buildGenerationPrompt(query, retrievedChunks, lang = "ZH") {
  const contextText = retrievedChunks
    .map((c, i) => `[出处 ${i + 1}: ${c.metadata.doc_id || c.docId}]\n${c.rawContent || c.content}`)
    .join("\n\n---\n\n");

  const langInstruction =
    lang === "ZH"
      ? "请用中文回答。"
      : lang === "JA"
      ? "日本語で回答してください。"
      : lang === "KO"
      ? "한국어로 답하십시오."
      : "Please answer in English.";

  return {
    system: `You are CrossX, an AI travel assistant. You MUST answer ONLY using the provided knowledge base context below.
STRICT RULES:
1. DO NOT use any external knowledge, training data, or guesses beyond the provided context.
2. If the context does not contain sufficient information to answer the question, you MUST output EXACTLY: "${FALLBACK_RESPONSE[lang] || FALLBACK_RESPONSE.EN}"
3. Cite the source doc_id when you use information from it, e.g. "[PAY-CN-001]".
4. Format the answer clearly with markdown (bold for key terms, bullet points for steps).
5. ${langInstruction}

KNOWLEDGE BASE CONTEXT:
---
${contextText}
---`,
    user: query,
  };
}

// ---------------------------------------------------------------------------
// Main retrieve_and_generate pipeline
// ---------------------------------------------------------------------------

/**
 * Full RAG pipeline: retrieve → build prompt → call LLM → return response with citations.
 *
 * @param {object} params
 *   - query: string
 *   - audience: "b2c" | "b2b"
 *   - language: "ZH" | "EN" | "JA" | "KO"
 *   - target_country: optional string
 *   - category: optional string
 *   - openaiApiKey: string
 *   - topK: number (default 4)
 * @returns {object} { answer, citations, intentType, ragUsed, sources }
 */
async function retrieveAndGenerate(params) {
  const {
    query,
    audience = "b2c",
    language = "ZH",
    target_country,
    category,
    openaiApiKey,
    topK = 4,
  } = params;

  // AC1: Intent routing
  const intentType = classifyIntent(query);

  // If pure action intent, skip RAG
  if (intentType === "action") {
    return { answer: null, citations: [], intentType, ragUsed: false, sources: [] };
  }

  // Retrieve relevant chunks
  const chunks = await retrieve(query, {
    audience,
    target_country,
    category,
    language: language === "ZH" ? "zh" : language === "JA" ? "ja" : language === "KO" ? "ko" : "en",
    topK,
    openaiApiKey,
  });

  if (chunks.length === 0) {
    return {
      answer: FALLBACK_RESPONSE[language] || FALLBACK_RESPONSE.EN,
      citations: [],
      intentType,
      ragUsed: true,
      sources: [],
    };
  }

  // AC3: Build citation list
  const citations = chunks.map((c) => ({
    docId: c.metadata.doc_id || c.docId,
    title: c.metadata.title || c.headingPath || c.metadata.doc_id,
    score: Math.round(c.score * 100) / 100,
  }));

  // AC2: Build strict grounding prompt
  const { system, user } = buildGenerationPrompt(query, chunks, language);

  // Call LLM
  let answer;
  try {
    answer = await callOpenAIForRag(system, user, openaiApiKey);
  } catch (e) {
    answer = FALLBACK_RESPONSE[language] || FALLBACK_RESPONSE.EN;
  }

  return {
    answer,
    citations,
    intentType,
    ragUsed: true,
    sources: citations.map((c) => c.docId),
    chunks: chunks.map((c) => ({
      docId: c.docId,
      heading: c.headingPath,
      score: c.score,
    })),
  };
}

async function callOpenAIForRag(systemPrompt, userMessage, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });
    const req = https.request(
      {
        hostname: "api.openai.com",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.choices?.[0]?.message?.content;
            if (text) resolve(text.trim());
            else reject(new Error(parsed.error?.message || "No content"));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ingestMarkdownFile,
  ingestAllDocs,
  retrieve,
  retrieveAndGenerate,
  classifyIntent,
  applyMetadataFilter,
  loadStore,
  FALLBACK_RESPONSE,
  DOCS_DIR,
};
