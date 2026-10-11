import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/warehouse/schema.prisma',
  datasource: { url: 'file:.data/warehouse.db' },
});
