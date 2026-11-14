import { expect, test } from '@jest/globals';
import { FlexMessage, createCardBubble } from '../app/messages/index.js';

test('createCardBubble builds a header, body with stars, and buttons', () => {
  const bubble = createCardBubble({
    title: '今日推薦',
    subtitle: '台北・咖啡',
    text: '手沖單品，安靜好讀書。',
    rating: 4,
    buttons: [{ label: '預約', text: '預約' }, { label: '更多', text: '更多' }],
  });
  expect(bubble.type).toBe('bubble');
  expect(bubble.header.contents.map(({ text }) => text)).toEqual(['今日推薦', '台北・咖啡']);
  expect(bubble.body.contents[1].text).toBe('★★★★☆ 4');
  expect(bubble.footer.contents).toHaveLength(2);
  expect(bubble.footer.contents[0]).toMatchObject({
    type: 'button',
    style: 'primary',
    action: { type: 'message', label: '預約', text: '預約' },
  });
});

test('createCardBubble leaves out empty sections', () => {
  const bubble = createCardBubble({ title: '只有標題' });
  expect(bubble.body).toBeUndefined();
  expect(bubble.footer).toBeUndefined();
});

test('FlexMessage serializes to the LINE message shape', () => {
  const contents = createCardBubble({ title: 'Hi' });
  const message = new FlexMessage({ altText: 'x'.repeat(2000), contents });
  const json = JSON.parse(JSON.stringify(message));
  expect(json.type).toBe('flex');
  expect(json.altText).toHaveLength(1500);
  expect(json.contents).toEqual(contents);
});
