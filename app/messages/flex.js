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

export {
  createCardBubble,
};

export default FlexMessage;
