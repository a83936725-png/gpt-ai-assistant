import { MESSAGE_TYPE_FLEX } from '../../services/line.js';
import { MessageAction } from '../actions/index.js';
import Message from './message.js';

// LINE limits the alternative text of a Flex Message to 1,500 characters.
const MAX_ALT_TEXT_LENGTH = 1500;
const MAX_RATING = 5;

class FlexMessage extends Message {
  type = MESSAGE_TYPE_FLEX;

  altText;

  contents;

  /**
   * @param {Object} param
   * @param {string} param.altText Text shown in notifications and chat lists.
   * @param {Object} param.contents A Flex bubble or carousel container.
   */
  constructor({
    altText,
    contents,
  }) {
    super();
    this.altText = String(altText).slice(0, MAX_ALT_TEXT_LENGTH);
    this.contents = contents;
  }
}

/**
 * Builds a card bubble with a header (頁首列), body text, an optional star rating (評分星級)
 * and buttons (按鈕) that send their command text back to the bot.
 * @param {Object} param
 * @param {string} param.title
 * @param {string} [param.subtitle]
 * @param {string} [param.text]
 * @param {number} [param.rating] 0 to 5.
 * @param {Array<{ label: string, text: string }>} [param.buttons]
 * @returns {Object}
 */
const createCardBubble = ({
  title,
  subtitle,
  text,
  rating,
  buttons = [],
}) => {
  const header = [{
    type: 'text', text: title, weight: 'bold', size: 'lg', wrap: true,
  }];
  if (subtitle) {
    header.push({
      type: 'text', text: subtitle, size: 'xs', color: '#8C8C8C', wrap: true,
    });
  }
  const body = [];
  if (text) {
    body.push({
      type: 'text', text, size: 'sm', wrap: true,
    });
  }
  if (typeof rating === 'number') {
    const stars = Math.round(Math.min(Math.max(rating, 0), MAX_RATING));
    body.push({
      type: 'text',
      text: `${'★'.repeat(stars)}${'☆'.repeat(MAX_RATING - stars)} ${rating}`,
      size: 'sm',
      color: '#E0A800',
    });
  }
  const bubble = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', contents: header },
  };
  if (body.length > 0) {
    bubble.body = {
      type: 'box', layout: 'vertical', spacing: 'md', contents: body,
    };
  }
  if (buttons.length > 0) {
    bubble.footer = {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: buttons.map((button, i) => ({
        type: 'button',
        style: i === 0 ? 'primary' : 'secondary',
        height: 'sm',
        action: new MessageAction(button),
      })),
    };
  }
  return bubble;
};

const MAX_KPI_METRICS = 6;

// 升跌變化的顏色：含「-」或「↓」為紅，含「+」或「↑」為綠，其餘中性灰。
const deltaColor = (delta) => {
  if (/[-↓]/.test(delta)) return '#C0392B';
  if (/[+↑]/.test(delta)) return '#2E8B57';
  return '#8C8C8C';
};

/**
 * Builds a KPI card (大數字彈出 + 升跌變化): a title and up to six metrics,
 * each a big number with an optional coloured delta.
 * @param {Object} param
 * @param {string} [param.title]
 * @param {Array<{ label: string, value: string, delta?: string }>} param.metrics
 * @returns {Object}
 */
const createKpiBubble = ({
  title,
  metrics = [],
}) => {
  const rows = metrics.slice(0, MAX_KPI_METRICS).map((m) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'none',
    contents: [
      {
        type: 'text', text: String(m.label || '—'), size: 'xs', color: '#8C8C8C', wrap: true,
      },
      {
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
          {
            type: 'text', text: String(m.value), size: 'xxl', weight: 'bold', flex: 0,
          },
          ...(m.delta ? [{
            type: 'text', text: String(m.delta), size: 'sm', color: deltaColor(m.delta), gravity: 'bottom',
          }] : []),
        ],
      },
    ],
  }));
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'lg',
      contents: [
        ...(title ? [{
          type: 'text', text: String(title), weight: 'bold', size: 'md', wrap: true,
        }] : []),
        ...rows,
      ],
    },
  };
};

export {
  createCardBubble,
  createKpiBubble,
};

export default FlexMessage;
