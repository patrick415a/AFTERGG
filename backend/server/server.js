const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createApp } = require('./app');
const port = Number(process.env.PORT) || 4000;
const app = createApp({ apiKey: process.env.RIOT_API_KEY });
app.listen(port, '0.0.0.0', () => console.log(`AFTERGG API: http://localhost:${port}`));
