import {
  type CategoryInput,
  categoryInputSchema,
  type ProductInput,
  productInputSchema,
  type ReasonCodeInput,
  reasonCodeInputSchema,
} from '#/admin/catalog-input';
import { authorizeAdmin, authorizeDesk } from '#/server/auth/authorize';
import type { SessionClaims } from '#/server/auth/session';
import type { CatalogClient, GlobalClient } from '#/server/db/clients';
import type { DeskError } from '#/server/desk/warehouses.server';

export type CatalogDeps = { global: GlobalClient; catalog: CatalogClient };

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  barcodes: string[];
  malformed?: true;
  uom: string;
  categoryId: string | null;
  categoryName: string | null;
  countTolerance: number | null;
  effectiveTolerance: number;
};

export type CategoryRow = {
  id: string;
  name: string;
  countTolerance: number;
  productCount: number;
};

export type ReasonCodeRow = {
  code: string;
  label: string;
  appliesTo: string[];
  malformed?: true;
  system: boolean;
};

const SYSTEM_CODES = new Set(['COUNT_AUTO', 'INITIAL']);

const systemCode: DeskError = {
  ok: false,
  code: 'INVALID',
  message: "System reason codes can't be changed",
};
const invalid = (message: string): DeskError => ({
  ok: false,
  code: 'INVALID',
  message,
});

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'P2002'
  );
}

function parseStrings(json: string): { values: string[]; malformed: boolean } {
  try {
    const v: unknown = JSON.parse(json);
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
      return { values: v as string[], malformed: false };
    }
  } catch {
    // fall through
  }
  return { values: [], malformed: true };
}

type CatalogTx = Parameters<Parameters<CatalogClient['$transaction']>[0]>[0];

/**
 * First SKU or barcode of `candidate` already used by another product.
 * `barcodes` is a JSON column, so the DB cannot enforce uniqueness.
 */
async function findConflicts(
  catalog: CatalogClient | CatalogTx,
  candidate: { sku: string; barcodes: string[] },
  excludeProductId?: string,
): Promise<DeskError | null> {
  const others = await catalog.product.findMany({
    where: excludeProductId ? { id: { not: excludeProductId } } : undefined,
    select: { sku: true, name: true, barcodes: true },
  });
  for (const o of others) {
    if (o.sku === candidate.sku) {
      return invalid(`${candidate.sku} is already used by ${o.sku} ${o.name}`);
    }
  }
  const wanted = new Set(candidate.barcodes);
  for (const o of others) {
    for (const b of parseStrings(o.barcodes).values) {
      if (wanted.has(b)) {
        return invalid(`${b} is already used by ${o.sku} ${o.name}`);
      }
    }
  }
  return null;
}

async function skuHolderError(
  catalog: CatalogClient,
  sku: string,
): Promise<DeskError | null> {
  const holder = await catalog.product.findUnique({ where: { sku } });
  return holder
    ? invalid(`${sku} is already used by ${holder.sku} ${holder.name}`)
    : null;
}

async function categoryMissing(
  catalog: CatalogClient | CatalogTx,
  categoryId: string | null | undefined,
): Promise<DeskError | null> {
  if (!categoryId) return null;
  const c = await catalog.productCategory.findUnique({
    where: { id: categoryId },
  });
  return c ? null : invalid('Category not found');
}

export async function listProductsCore(
  catalog: CatalogClient,
  opts: { search?: string } = {},
): Promise<ProductRow[]> {
  const [products, categories] = await Promise.all([
    catalog.product.findMany({ orderBy: { sku: 'asc' } }),
    catalog.productCategory.findMany(),
  ]);
  const cats = new Map(categories.map((c) => [c.id, c]));
  const term = opts.search?.trim().toLowerCase() ?? '';
  const rows: ProductRow[] = [];
  for (const p of products) {
    const { values, malformed } = parseStrings(p.barcodes);
    if (
      term &&
      !p.sku.toLowerCase().includes(term) &&
      !p.name.toLowerCase().includes(term) &&
      !values.some((b) => b.toLowerCase().includes(term))
    ) {
      continue;
    }
    const cat = p.categoryId ? cats.get(p.categoryId) : undefined;
    rows.push({
      id: p.id,
      sku: p.sku,
      name: p.name,
      barcodes: values,
      ...(malformed ? { malformed: true as const } : {}),
      uom: p.uom,
      categoryId: p.categoryId,
      categoryName: cat?.name ?? null,
      countTolerance: p.countTolerance,
      effectiveTolerance: p.countTolerance ?? cat?.countTolerance ?? 0,
    });
  }
  return rows;
}

export async function createProductCore(
  catalog: CatalogClient,
  input: ProductInput,
): Promise<{ ok: true; id: string } | DeskError> {
  const p = productInputSchema.parse(input);
  try {
    return await catalog.$transaction(async (tx) => {
      const conflict = await findConflicts(tx, p);
      if (conflict) return conflict;
      const missing = await categoryMissing(tx, p.categoryId);
      if (missing) return missing;
      // An id can be held by a product whose SKU was renamed (update keeps
      // the id), so pick the first free `prod-<sku>` or `prod-<sku>-<n>`.
      const base = `prod-${p.sku.toLowerCase()}`;
      const taken = new Set(
        (
          await tx.product.findMany({
            where: { id: { startsWith: base } },
            select: { id: true },
          })
        ).map((r) => r.id),
      );
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      await tx.product.create({
        data: {
          id,
          sku: p.sku,
          name: p.name,
          barcodes: JSON.stringify(p.barcodes),
          uom: p.uom,
          categoryId: p.categoryId ?? null,
          countTolerance: p.countTolerance ?? null,
        },
      });
      return { ok: true as const, id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const err = await skuHolderError(catalog, p.sku);
      if (err) return err;
    }
    throw e;
  }
}

export async function updateProductCore(
  catalog: CatalogClient,
  productId: string,
  input: ProductInput,
): Promise<{ ok: true } | DeskError> {
  const p = productInputSchema.parse(input);
  try {
    return await catalog.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({
        where: { id: productId },
      });
      if (!existing) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Product not found',
        };
      }
      const conflict = await findConflicts(tx, p, productId);
      if (conflict) return conflict;
      const missing = await categoryMissing(tx, p.categoryId);
      if (missing) return missing;
      await tx.product.update({
        where: { id: productId },
        data: {
          sku: p.sku,
          name: p.name,
          barcodes: JSON.stringify(p.barcodes),
          uom: p.uom,
          // undefined leaves a field alone; null clears it.
          ...(p.categoryId !== undefined ? { categoryId: p.categoryId } : {}),
          ...(p.countTolerance !== undefined
            ? { countTolerance: p.countTolerance }
            : {}),
        },
      });
      return { ok: true as const };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const err = await skuHolderError(catalog, p.sku);
      if (err) return err;
    }
    throw e;
  }
}

export async function listCategoriesCore(
  catalog: CatalogClient,
): Promise<CategoryRow[]> {
  const cats = await catalog.productCategory.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    countTolerance: c.countTolerance,
    productCount: c._count.products,
  }));
}

export async function createCategoryCore(
  catalog: CatalogClient,
  input: CategoryInput,
): Promise<{ ok: true; id: string }> {
  const c = categoryInputSchema.parse(input);
  const id = `cat-${crypto.randomUUID()}`;
  await catalog.productCategory.create({ data: { id, ...c } });
  return { ok: true, id };
}

export async function updateCategoryCore(
  catalog: CatalogClient,
  categoryId: string,
  input: CategoryInput,
): Promise<{ ok: true } | DeskError> {
  const c = categoryInputSchema.parse(input);
  const existing = await catalog.productCategory.findUnique({
    where: { id: categoryId },
  });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Category not found' };
  }
  await catalog.productCategory.update({ where: { id: categoryId }, data: c });
  return { ok: true };
}

export async function listReasonCodesAdminCore(
  catalog: CatalogClient,
): Promise<ReasonCodeRow[]> {
  const rows = await catalog.reasonCode.findMany({ orderBy: { code: 'asc' } });
  return rows.map((r) => {
    const { values, malformed } = parseStrings(r.appliesTo);
    return {
      code: r.code,
      label: r.label,
      appliesTo: values,
      ...(malformed ? { malformed: true as const } : {}),
      system: SYSTEM_CODES.has(r.code),
    };
  });
}

export async function createReasonCodeCore(
  catalog: CatalogClient,
  input: ReasonCodeInput,
): Promise<{ ok: true } | DeskError> {
  const r = reasonCodeInputSchema.parse(input);
  if (SYSTEM_CODES.has(r.code)) return systemCode;
  try {
    await catalog.reasonCode.create({
      data: {
        code: r.code,
        label: r.label,
        appliesTo: JSON.stringify(r.appliesTo),
      },
    });
  } catch (e) {
    if (
      isUniqueViolation(e) &&
      (await catalog.reasonCode.findUnique({ where: { code: r.code } }))
    ) {
      return invalid(`Code ${r.code} is already used`);
    }
    throw e;
  }
  return { ok: true };
}

export async function updateReasonCodeCore(
  catalog: CatalogClient,
  code: string,
  input: Omit<ReasonCodeInput, 'code'>,
): Promise<{ ok: true } | DeskError> {
  if (SYSTEM_CODES.has(code)) return systemCode;
  const r = reasonCodeInputSchema.omit({ code: true }).parse(input);
  const existing = await catalog.reasonCode.findUnique({ where: { code } });
  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Reason code not found' };
  }
  await catalog.reasonCode.update({
    where: { code },
    data: { label: r.label, appliesTo: JSON.stringify(r.appliesTo) },
  });
  return { ok: true };
}

export async function handleListProducts(
  claims: SessionClaims | null,
  input: { search?: string },
  deps: CatalogDeps,
) {
  await authorizeDesk(claims, deps.global);
  return listProductsCore(deps.catalog, input);
}

export async function handleCreateProduct(
  claims: SessionClaims | null,
  input: ProductInput,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return createProductCore(deps.catalog, input);
}

export async function handleUpdateProduct(
  claims: SessionClaims | null,
  input: { productId: string } & ProductInput,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  const { productId, ...rest } = input;
  return updateProductCore(deps.catalog, productId, rest);
}

export async function handleListCategories(
  claims: SessionClaims | null,
  _input: Record<string, never>,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return listCategoriesCore(deps.catalog);
}

export async function handleCreateCategory(
  claims: SessionClaims | null,
  input: CategoryInput,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return createCategoryCore(deps.catalog, input);
}

export async function handleUpdateCategory(
  claims: SessionClaims | null,
  input: { categoryId: string } & CategoryInput,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  const { categoryId, ...rest } = input;
  return updateCategoryCore(deps.catalog, categoryId, rest);
}

export async function handleListReasonCodesAdmin(
  claims: SessionClaims | null,
  _input: Record<string, never>,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return listReasonCodesAdminCore(deps.catalog);
}

export async function handleCreateReasonCode(
  claims: SessionClaims | null,
  input: ReasonCodeInput,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return createReasonCodeCore(deps.catalog, input);
}

export async function handleUpdateReasonCode(
  claims: SessionClaims | null,
  input: { code: string } & Omit<ReasonCodeInput, 'code'>,
  deps: CatalogDeps,
) {
  await authorizeAdmin(claims, deps.global);
  const { code, ...rest } = input;
  return updateReasonCodeCore(deps.catalog, code, rest);
}
