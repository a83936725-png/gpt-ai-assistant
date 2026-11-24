// Imported first by trainer.test.js: config is read once at import, so the environment has to be in
// place before any app module loads. Customer service mode is on, as on the real official account.
process.env.SERVICE_MODE_ENABLED = 'true';
process.env.APP_ALLOWED_USER_IDS = '000001,000002';
process.env.TRAINER_RPC_URL = 'https://expo.test/api/rpc';
process.env.TRAINER_SECRET = 'test-secret';
process.env.TRAINER_USER_IDS = '000001';
