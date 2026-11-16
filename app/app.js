import config from '../config/index.js';
import { replyMessage } from '../utils/index.js';
import {
  activateHandler,
  commandHandler,
  continueHandler,
  deactivateHandler,
  deployHandler,
  docHandler,
  drawHandler,
  forgetHandler,
  enquireHandler,
  idHandler,
  kpiHandler,
  mediaHandler,
  modelsHandler,
  postHandler,
  reportHandler,
  retryHandler,
  searchHandler,
  serviceHandler,
  talkHandler,
  uiHandler,
  versionHandler,
} from './handlers/index.js';
import Context from './context.js';
import Event from './models/event.js';

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const handleContext = async (context) => (
  // 「畫介面」「畫圖示」「畫動畫」 must run before the draw handler, whose alias 「畫」 would match them too.
  uiHandler(context)
  || mediaHandler(context)
  || activateHandler(context)
  || commandHandler(context)
  || continueHandler(context)
  || deactivateHandler(context)
  || deployHandler(context)
  || docHandler(context)
  || drawHandler(context)
  || forgetHandler(context)
  || enquireHandler(context)
  || idHandler(context)
  || kpiHandler(context)
  || modelsHandler(context)
  || postHandler(context)
  || reportHandler(context)
  || retryHandler(context)
  || searchHandler(context)
  || versionHandler(context)
  || talkHandler(context)
  || context
);

/**
 * Customer service mode: one-to-one chats get answers from the knowledge base only, so customers
 * cannot reach drawing, search or other commands. Groups get no reply.
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const handleServiceContext = async (context) => (
  idHandler(context)
  || serviceHandler(context)
  || context
);

/**
 * A source that is not on the allowlist can only ask for its ID.
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const handleBlockedContext = async (context) => (
  idHandler(context)
  || context.pushNotAllowed()
);

/**
 * @param {Context} context
 * @returns {Promise<Context>}
 */
const routeContext = (context) => {
  if (context.isBlocked) return handleBlockedContext(context);
  if (context.error || context.isFlagged) return context;
  if (config.SERVICE_MODE_ENABLED) return handleServiceContext(context);
  return handleContext(context);
};

const handleEvents = async (events = []) => (
  (Promise.all(
    (await Promise.all(
      (await Promise.all(
        events
          .map((event) => new Event(event))
          .filter((event) => event.isMessage)
          .filter((event) => event.isText || event.isAudio || event.isImage)
          .map((event) => new Context(event))
          .map((context) => context.initialize()),
      ))
        .map(routeContext),
    ))
      .filter((context) => context.messages.length > 0)
      .map((context) => replyMessage(context)),
  ))
);

export {
  handleServiceContext,
};

export default handleEvents;
