import fs from 'fs';
import path from 'path';
import config from '../../config/index.js';

/**
 * One searchable piece of the knowledge base: a "## " section of a Markdown file.
 * @typedef {Object} Section
 * @property {string} source File name, relative to the knowledge directory.
 * @property {string} title The file's "# " title, or its name when it has none.
 * @property {string} heading The section's "## " heading, or '' for text before the first one.
 * @property {string} text The section body.
 */

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.txt'];

/**
 * Files whose name starts with "_" or "." and README files are notes for editors, not knowledge.
 * @param {string} name
 * @returns {boolean}
 */
const isKnowledgeFile = (name) => (
  MARKDOWN_EXTENSIONS.includes(path.extname(name).toLowerCase())
  && !name.startsWith('_')
  && !name.startsWith('.')
  && path.basename(name, path.extname(name)).toLowerCase() !== 'readme'
);

/**
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Array<string>} Paths relative to the knowledge directory, sorted.
 */
const listFiles = (dir, prefix = '') => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) return [];
        return listFiles(path.join(dir, entry.name), relative);
      }
      return isKnowledgeFile(entry.name) ? [relative] : [];
    })
    .sort();
};

/**
 * Splits a Markdown document into its "## " sections.
 * @param {string} source
 * @param {string} content
 * @returns {Array<Section>}
 */
const parseDocument = (source, content) => {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const titleLine = lines.find((line) => /^#\s+/.test(line));
  const title = titleLine
    ? titleLine.replace(/^#\s+/, '').trim()
    : path.basename(source, path.extname(source));
  const sections = [];
  let current = { heading: '', lines: [] };
  const flush = () => {
    const text = current.lines.join('\n').trim();
    if (text) {
      sections.push({
        source, title, heading: current.heading, text,
      });
    }
  };
  lines.forEach((line) => {
    if (line === titleLine) return;
    const match = line.match(/^##\s+(.*)$/);
    if (match) {
      flush();
      current = { heading: match[1].trim(), lines: [] };
      return;
    }
    current.lines.push(line);
  });
  flush();
  return sections;
};

/**
 * @param {string} [dir]
 * @returns {Array<Section>}
 */
const loadSections = (dir = path.resolve(process.cwd(), config.KNOWLEDGE_DIR)) => (
  listFiles(dir).flatMap((file) => parseDocument(file, fs.readFileSync(path.join(dir, file), 'utf8')))
);

/**
 * @param {Section} section
 * @returns {string}
 */
const formatSection = ({
  source, title, heading, text,
}) => (
  `【${title}${heading ? `／${heading}` : ''}】（來源：${source}）\n${text}`
);

/**
 * Words for matching: whole Latin words and numbers, and every pair of adjacent CJK characters,
 * which works for Chinese without a word segmenter.
 * @param {string} text
 * @returns {Set<string>}
 */
const tokenize = (text) => {
  const tokens = new Set();
  const lower = text.toLowerCase();
  (lower.match(/[a-z0-9]+(?:[.-][a-z0-9]+)*/g) || []).forEach((word) => tokens.add(word));
  (lower.match(/[㐀-鿿豈-﫿]+/g) || []).forEach((run) => {
    if (run.length === 1) tokens.add(run);
    for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2));
  });
  return tokens;
};

/**
 * @param {Set<string>} queryTokens
 * @param {Section} section
 * @returns {number}
 */
const scoreSection = (queryTokens, section) => {
  const headTokens = tokenize(`${section.title} ${section.heading}`);
  const bodyTokens = tokenize(section.text);
  let score = 0;
  queryTokens.forEach((token) => {
    if (headTokens.has(token)) score += 3;
    if (bodyTokens.has(token)) score += 1;
  });
  return score;
};

class KnowledgeBase {
  /**
   * @type {Array<Section>}
   */
  sections;

  /**
   * @param {Array<Section>} sections
   */
  constructor(sections = []) {
    this.sections = sections;
  }

  get isEmpty() {
    return this.sections.length === 0;
  }

  get size() {
    return this.sections.reduce((total, section) => total + formatSection(section).length, 0);
  }

  /**
   * The knowledge to hand the model for a question. When the whole base fits in maxChars it all
   * goes in, so nothing can be missed; otherwise the best-matching sections fill the budget.
   * @param {string} query The question, plus recent conversation for follow-ups.
   * @param {number} [maxChars]
   * @returns {Array<Section>}
   */
  select(query, maxChars = config.KNOWLEDGE_MAX_CHARS) {
    if (this.size <= maxChars) return this.sections;
    const queryTokens = tokenize(query);
    const ranked = this.sections
      .map((section, index) => ({ section, index, score: scoreSection(queryTokens, section) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const picked = [];
    let used = 0;
    ranked.forEach(({ section, index }) => {
      const { length } = formatSection(section);
      if (used + length > maxChars) return;
      picked.push({ section, index });
      used += length;
    });
    // Keep the original order so related sections of one file read naturally.
    return picked.sort((a, b) => a.index - b.index).map(({ section }) => section);
  }

  /**
   * @param {string} query
   * @param {number} [maxChars]
   * @returns {string}
   */
  buildContext(query, maxChars) {
    return this.select(query, maxChars).map(formatSection).join('\n\n');
  }
}

let knowledgeBase;

/**
 * The knowledge base, read from disk once per process.
 * @returns {KnowledgeBase}
 */
const getKnowledgeBase = () => {
  if (!knowledgeBase) knowledgeBase = new KnowledgeBase(loadSections());
  return knowledgeBase;
};

/**
 * The knowledge base as plain data for other sites, such as the staff Q&A page on the expo SOP
 * site. Only what customers can already get from the bot is in here.
 * @param {KnowledgeBase} [base]
 * @returns {{sections: Array<Section>}}
 */
const exportKnowledge = (base = getKnowledgeBase()) => ({
  sections: base.sections.map(({
    source, title, heading, text,
  }) => ({
    source, title, heading, text,
  })),
});

/**
 * Replaces the cached knowledge base, e.g. with one read from another directory in tests.
 * @param {KnowledgeBase} [base] Omit to re-read the knowledge directory on next use.
 */
const setKnowledgeBase = (base) => {
  knowledgeBase = base;
};

export {
  KnowledgeBase,
  exportKnowledge,
  getKnowledgeBase,
  setKnowledgeBase,
  loadSections,
  parseDocument,
  tokenize,
};

export default getKnowledgeBase;
