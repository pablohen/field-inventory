import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/catalog/schema.prisma',
  datasource: { url: 'file:.data/catalog.db' },
});
