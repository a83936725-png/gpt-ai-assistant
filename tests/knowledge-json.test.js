import {
  afterAll, beforeAll, describe, expect, test,
} from '@jest/globals';
import app from '../api/index.js';
import { exportKnowledge, KnowledgeBase, parseDocument } from '../app/knowledge/index.js';

describe('exportKnowledge', () => {
  test('lists each section with its file, title and heading', () => {
    const base = new KnowledgeBase(parseDocument('運送.md', '# 運送方式\n\n## 運費\n冷凍宅配 160 元。\n'));
    expect(exportKnowledge(base)).toEqual({
      sections: [{
        source: '運送.md', title: '運送方式', heading: '運費', text: '冷凍宅配 160 元。',
      }],
    });
  });

  test('includes the product facts gathered from the expo reception script', () => {
    const headings = exportKnowledge().sections.map(({ heading }) => heading);
    expect(headings).toContain('每一批都有檢驗嗎');
    expect(headings).toContain('懷孕各階段建議喝哪一種口味');
  });
});

describe('GET /knowledge.json', () => {
  let server;
  let origin;

  beforeAll(async () => {
    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => {
    server.close(resolve);
  }));

  test('answers with the knowledge base and lets other sites read it', async () => {
    const res = await fetch(`${origin}/knowledge.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = await res.json();
    expect(body.sections.length).toBeGreaterThan(0);
    expect(body.sections.every(({ text }) => typeof text === 'string' && text.length > 0)).toBe(true);
  });
});
