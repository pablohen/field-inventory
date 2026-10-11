import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/global/schema.prisma',
  datasource: { url: 'file:.data/global.db' },
});
