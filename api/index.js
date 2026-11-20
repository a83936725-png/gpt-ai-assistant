import express from 'express';
import { handleEvents, printPrompts } from '../app/index.js';
import { exportKnowledge } from '../app/knowledge/index.js';
import config from '../config/index.js';
import { validateLineSignature } from '../middleware/index.js';
import storage from '../storage/index.js';
import { fetchVersion, getVersion } from '../utils/index.js';
import { getStoredImage, setPublicOrigin } from '../utils/upload-image.js';
import ikigai from '../web/ikigai.js';

const app = express();

app.get('/images/:name', (req, res) => {
  const image = getStoredImage(req.params.name);
  if (!image) {
    res.sendStatus(404);
    return;
  }
  res.set('Content-Type', image.contentType);
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(image.buffer);
});

// The customer service knowledge base, for the staff Q&A page on the expo SOP site. It holds only
// what the bot already tells customers, so any site may read it.
app.get('/knowledge.json', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.json(exportKnowledge());
});

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  },
}));

app.use('/ikigai', ikigai);

app.get('/', async (req, res) => {
  if (config.APP_URL) {
    res.redirect(config.APP_URL);
    return;
  }
  const currentVersion = getVersion();
  const latestVersion = await fetchVersion();
  res.status(200).send({ status: 'OK', currentVersion, latestVersion });
});

app.post(config.APP_WEBHOOK_PATH, validateLineSignature, async (req, res) => {
  try {
    const protocol = (req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
    setPublicOrigin(`${protocol}://${req.get('host')}`);
    await storage.initialize();
    await handleEvents(req.body.events);
    res.sendStatus(200);
  } catch (err) {
    console.error(err.message);
    res.sendStatus(500);
  }
  if (config.APP_DEBUG) printPrompts();
});

if (config.APP_PORT) {
  app.listen(config.APP_PORT);
}

export default app;
