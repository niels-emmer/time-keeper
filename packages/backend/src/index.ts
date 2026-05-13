import { runMigrations } from './db/client.js';
import { createApp } from './app.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

function assertProductionSecurityConfig(): void {
  if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_PROXY_SECRET) {
    throw new Error('INTERNAL_PROXY_SECRET must be set in production');
  }
}

assertProductionSecurityConfig();
runMigrations();

const app = createApp();

app.listen(PORT, () => {
  console.log(`Time-keeper backend running on port ${PORT}`);
});
