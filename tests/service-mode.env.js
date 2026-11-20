// Imported first by service-mode.test.js: config is read once at import, so the service-mode
// environment has to be in place before any app module loads.
process.env.SERVICE_MODE_ENABLED = 'true';
process.env.APP_ALLOWED_USER_IDS = '000001';
