import { runMigrations } from './db/client.js';
import { createApp } from './app.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

runMigrations();

const app = createApp();

app.listen(PORT, () => {
  console.log(`Time-keeper backend running on port ${PORT}`);
});
