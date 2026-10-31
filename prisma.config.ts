import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The CLI (migrate, studio) uses the session pooler; the app itself connects
// through the transaction pooler via the pg driver adapter (see PrismaService).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DIRECT_URL'],
  },
});
