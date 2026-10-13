import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  categoryInputSchema,
  listProductsInputSchema,
  productInputSchema,
  reasonCodeInputSchema,
  updateCategoryInputSchema,
  updateProductInputSchema,
  updateReasonCodeInputSchema,
} from '#/admin/catalog-input';
import { catalogDb, globalDb } from '#/server/db/clients';
import { readDeskClaims } from '#/server/desk/session';
import {
  handleCreateCategory,
  handleCreateProduct,
  handleCreateReasonCode,
  handleListCategories,
  handleListProducts,
  handleListReasonCodesAdmin,
  handleUpdateCategory,
  handleUpdateProduct,
  handleUpdateReasonCode,
} from './catalog.server';

const deps = () => ({ global: globalDb(), catalog: catalogDb() });
const noInput = z.object({});

export const listProducts = createServerFn({ method: 'GET' })
  .validator((d: unknown) => listProductsInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleListProducts(await readDeskClaims(), data, deps()),
  );

export const createProduct = createServerFn({ method: 'POST' })
  .validator((d: unknown) => productInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreateProduct(await readDeskClaims(), data, deps()),
  );

export const updateProduct = createServerFn({ method: 'POST' })
  .validator((d: unknown) => updateProductInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleUpdateProduct(await readDeskClaims(), data, deps()),
  );

export const listCategories = createServerFn({ method: 'GET' })
  .validator((d: unknown) => noInput.parse(d ?? {}))
  .handler(async ({ data }) =>
    handleListCategories(await readDeskClaims(), data, deps()),
  );

export const createCategory = createServerFn({ method: 'POST' })
  .validator((d: unknown) => categoryInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreateCategory(await readDeskClaims(), data, deps()),
  );

export const updateCategory = createServerFn({ method: 'POST' })
  .validator((d: unknown) => updateCategoryInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleUpdateCategory(await readDeskClaims(), data, deps()),
  );

export const listReasonCodesAdmin = createServerFn({ method: 'GET' })
  .validator((d: unknown) => noInput.parse(d ?? {}))
  .handler(async ({ data }) =>
    handleListReasonCodesAdmin(await readDeskClaims(), data, deps()),
  );

export const createReasonCode = createServerFn({ method: 'POST' })
  .validator((d: unknown) => reasonCodeInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleCreateReasonCode(await readDeskClaims(), data, deps()),
  );

export const updateReasonCode = createServerFn({ method: 'POST' })
  .validator((d: unknown) => updateReasonCodeInputSchema.parse(d))
  .handler(async ({ data }) =>
    handleUpdateReasonCode(await readDeskClaims(), data, deps()),
  );
