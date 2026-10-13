import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  categoryInputSchema,
  productInputSchema,
  reasonCodeInputSchema,
} from '#/admin/catalog-input';
import type { Movement } from '#/domain/types';
import {
  type CatalogDeps,
  createCategoryCore,
  createProductCore,
  createReasonCodeCore,
  handleCreateCategory,
  handleCreateProduct,
  handleCreateReasonCode,
  handleListCategories,
  handleListProducts,
  handleListReasonCodesAdmin,
  handleUpdateCategory,
  handleUpdateProduct,
  handleUpdateReasonCode,
  listCategoriesCore,
  listProductsCore,
  listReasonCodesAdminCore,
  updateCategoryCore,
  updateProductCore,
  updateReasonCodeCore,
} from '#/server/admin/catalog.server';
import type { SessionClaims } from '#/server/auth/session';
import type { CatalogClient } from '#/server/db/clients';
import { listReasonCodesCore } from '#/server/desk/stock.server';
import { loadContext, withMovementTx } from '#/server/sync/warehouse-repo';
import { createTestEnv, type TestEnv } from '../support/test-env';

const claims = (role: SessionClaims['role']): SessionClaims => ({
  userId: role,
  deviceId: 'desk',
  role,
  exp: 0,
});

const prod = (over: Record<string, unknown> = {}) => ({
  sku: 'A1',
  name: 'Anvil',
  barcodes: ['1111'],
  ...over,
});

async function status(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof Response ? e.status : -1;
  }
}

describe('catalog input schemas', () => {
  it('defaults uom and validates products', () => {
    expect(productInputSchema.parse(prod()).uom).toBe('EA');
    for (const bad of [
      prod({ sku: 'a b' }),
      prod({ sku: '' }),
      prod({ name: ' ' }),
      prod({ barcodes: ['abc'] }),
      prod({ barcodes: ['1111', '1111'] }),
      prod({ barcodes: Array.from({ length: 11 }, (_, i) => `${1000 + i}`) }),
      prod({ uom: 'x'.repeat(9) }),
      prod({ countTolerance: -1 }),
      prod({ countTolerance: 1.5 }),
    ]) {
      expect(productInputSchema.safeParse(bad).success).toBe(false);
    }
    expect(
      productInputSchema.safeParse(prod({ countTolerance: null })).success,
    ).toBe(true);
  });
  it('validates categories and reason codes', () => {
    expect(
      categoryInputSchema.safeParse({ name: 'x', countTolerance: -1 }).success,
    ).toBe(false);
    expect(
      categoryInputSchema.safeParse({ name: '', countTolerance: 1 }).success,
    ).toBe(false);
    for (const bad of [
      { code: 'DAMAGED', label: 'Damaged', appliesTo: ['BOGUS'] },
      { code: 'DAMAGED', label: 'Damaged', appliesTo: [] },
      { code: 'damaged', label: 'Damaged', appliesTo: ['ADJUST'] },
    ]) {
      expect(reasonCodeInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('catalog admin', () => {
  let env: TestEnv;
  let deps: CatalogDeps;
  let catalog: CatalogClient;

  beforeEach(async () => {
    env = await createTestEnv();
    for (const role of ['worker', 'supervisor', 'admin'] as const) {
      await env.seedUser({ id: role, username: role, pin: '1', role });
    }
    catalog = env.catalog;
    deps = { global: env.global, catalog };
  });
  afterEach(() => env.cleanup());

  describe('products', () => {
    it('creates with id prod-<sku lowercased> and lists effective tolerance', async () => {
      const cat = await createCategoryCore(catalog, {
        name: 'Heavy',
        countTolerance: 3,
      });
      const r = await createProductCore(
        catalog,
        prod({ sku: 'AB-1', categoryId: cat.id }),
      );
      expect(r).toEqual({ ok: true, id: 'prod-ab-1' });
      expect(await listProductsCore(catalog)).toEqual([
        {
          id: 'prod-ab-1',
          sku: 'AB-1',
          name: 'Anvil',
          barcodes: ['1111'],
          uom: 'EA',
          categoryId: cat.id,
          categoryName: 'Heavy',
          countTolerance: null,
          effectiveTolerance: 3,
        },
      ]);
    });

    it('falls back to -<n> when the id is taken by a renamed product', async () => {
      const a = await createProductCore(catalog, prod({ barcodes: [] }));
      expect(a).toEqual({ ok: true, id: 'prod-a1' });
      await updateProductCore(
        catalog,
        'prod-a1',
        prod({ sku: 'A2', barcodes: [] }),
      );
      const b = await createProductCore(
        catalog,
        prod({ name: 'Other', barcodes: [] }),
      );
      expect(b).toEqual({ ok: true, id: 'prod-a1-2' });
    });

    it('rejects a barcode used by another product', async () => {
      await createProductCore(catalog, prod());
      const r = await createProductCore(
        catalog,
        prod({ sku: 'B1', name: 'Bolt', barcodes: ['2222', '1111'] }),
      );
      expect(r).toEqual({
        ok: false,
        code: 'INVALID',
        message: '1111 is already used by A1 Anvil',
      });
      expect(await catalog.product.count()).toBe(1);
    });

    it('rejects a duplicate sku on create', async () => {
      await createProductCore(catalog, prod());
      const r = await createProductCore(
        catalog,
        prod({ name: 'Dup', barcodes: [] }),
      );
      expect(r).toEqual({
        ok: false,
        code: 'INVALID',
        message: 'A1 is already used by A1 Anvil',
      });
    });

    it('rejects updating to another product sku or barcode, allows own', async () => {
      await createProductCore(catalog, prod());
      await createProductCore(
        catalog,
        prod({ sku: 'B1', name: 'Bolt', barcodes: ['2222'] }),
      );
      expect(
        await updateProductCore(
          catalog,
          'prod-b1',
          prod({ sku: 'A1', name: 'Bolt', barcodes: ['2222'] }),
        ),
      ).toEqual({
        ok: false,
        code: 'INVALID',
        message: 'A1 is already used by A1 Anvil',
      });
      expect(
        await updateProductCore(
          catalog,
          'prod-b1',
          prod({ sku: 'B1', name: 'Bolt', barcodes: ['1111'] }),
        ),
      ).toMatchObject({
        ok: false,
        message: '1111 is already used by A1 Anvil',
      });
      expect(
        await updateProductCore(
          catalog,
          'prod-a1',
          prod({ name: 'Anvil 2', barcodes: ['1111', '3333'] }),
        ),
      ).toEqual({ ok: true });
      const rows = await listProductsCore(catalog, { search: 'anvil 2' });
      expect(rows[0]?.barcodes).toEqual(['1111', '3333']);
    });

    it('update of a missing product is NOT_FOUND; unknown category is INVALID', async () => {
      expect(await updateProductCore(catalog, 'nope', prod())).toMatchObject({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(
        await createProductCore(catalog, prod({ categoryId: 'nope' })),
      ).toMatchObject({ ok: false, code: 'INVALID' });
    });

    it('maps P2002 to the message only when another product holds the sku', async () => {
      await createProductCore(catalog, prod());
      const racy = {
        product: catalog.product,
        $transaction: async () => {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        },
      } as unknown as CatalogClient;
      expect(
        await createProductCore(racy, prod({ barcodes: [] })),
      ).toMatchObject({
        ok: false,
        code: 'INVALID',
        message: 'A1 is already used by A1 Anvil',
      });
      await expect(
        createProductCore(racy, prod({ sku: 'ZZ9', barcodes: [] })),
      ).rejects.toMatchObject({ code: 'P2002' });
      await expect(
        updateProductCore(racy, 'prod-a1', prod({ sku: 'ZZ9' })),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('searches by name, sku and barcode, ordered by sku', async () => {
      await createProductCore(catalog, prod());
      await createProductCore(
        catalog,
        prod({ sku: 'B1', name: 'Bolt', barcodes: ['BARCODE22'] }),
      );
      await createProductCore(
        catalog,
        prod({ sku: '0C', name: 'Cog', barcodes: [] }),
      );
      expect((await listProductsCore(catalog)).map((p) => p.sku)).toEqual([
        '0C',
        'A1',
        'B1',
      ]);
      const skus = async (search: string) =>
        (await listProductsCore(catalog, { search })).map((p) => p.sku);
      expect(await skus('bol')).toEqual(['B1']);
      expect(await skus('a1')).toEqual(['A1']);
      expect(await skus('barcode2')).toEqual(['B1']);
      expect(await skus('1111')).toEqual(['A1']);
      expect(await skus('zzz')).toEqual([]);
    });

    it('returns [] with malformed:true for bad barcodes json and never throws', async () => {
      await catalog.product.create({
        data: { id: 'bad', sku: 'BAD', name: 'Bad', barcodes: '{nope' },
      });
      await catalog.product.create({
        data: { id: 'bad2', sku: 'BAD2', name: 'Bad2', barcodes: '[1,2]' },
      });
      const rows = await listProductsCore(catalog);
      expect(rows.map((r) => [r.barcodes, r.malformed])).toEqual([
        [[], true],
        [[], true],
      ]);
      expect(
        await createProductCore(catalog, prod({ barcodes: ['1111'] })),
      ).toMatchObject({ ok: true });
    });

    it('countTolerance null clears the product tolerance so the category applies', async () => {
      const cat = await createCategoryCore(catalog, {
        name: 'C',
        countTolerance: 5,
      });
      await createProductCore(
        catalog,
        prod({ categoryId: cat.id, countTolerance: 1 }),
      );
      expect((await listProductsCore(catalog))[0]).toMatchObject({
        countTolerance: 1,
        effectiveTolerance: 1,
      });
      await updateProductCore(
        catalog,
        'prod-a1',
        prod({ categoryId: cat.id, countTolerance: null }),
      );
      expect((await listProductsCore(catalog))[0]).toMatchObject({
        countTolerance: null,
        effectiveTolerance: 5,
      });
    });
  });

  describe('categories', () => {
    it('creates, updates, lists with product count', async () => {
      const c = await createCategoryCore(catalog, {
        name: 'B',
        countTolerance: 1,
      });
      await createCategoryCore(catalog, { name: 'A', countTolerance: 0 });
      await createProductCore(catalog, prod({ categoryId: c.id }));
      expect(
        await updateCategoryCore(catalog, c.id, {
          name: 'B2',
          countTolerance: 2,
        }),
      ).toEqual({ ok: true });
      expect(await listCategoriesCore(catalog)).toEqual([
        {
          id: expect.any(String),
          name: 'A',
          countTolerance: 0,
          productCount: 0,
        },
        { id: c.id, name: 'B2', countTolerance: 2, productCount: 1 },
      ]);
      expect(
        await updateCategoryCore(catalog, 'nope', {
          name: 'x',
          countTolerance: 0,
        }),
      ).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('a category tolerance change is used by the next count', async () => {
      const cat = await createCategoryCore(catalog, {
        name: 'C',
        countTolerance: 1,
      });
      await createProductCore(catalog, prod({ categoryId: cat.id }));
      await env.seedWarehouse('wh1');
      const db = await env.warehouse('wh1');
      const count: Movement = {
        id: 'c1',
        type: 'COUNT',
        skuId: 'prod-a1',
        fromLocationId: null,
        toLocationId: 'L1',
        qty: 5,
        reasonCode: null,
        ref: null,
        counterpartWarehouseId: null,
        source: 'device',
        userId: 'worker',
        deviceId: 'dev1',
        occurredAt: new Date('2026-03-01T12:00:00Z'),
      };
      const tol = () =>
        withMovementTx(db, (tx) => loadContext(tx, catalog, count)).then(
          (c) => c.tolerance,
        );
      expect(await tol()).toBe(1);
      await updateCategoryCore(catalog, cat.id, {
        name: 'C',
        countTolerance: 7,
      });
      expect(await tol()).toBe(7);
    });
  });

  describe('reason codes', () => {
    it('creates, lists, updates; desk list honors appliesTo', async () => {
      expect(
        await createReasonCodeCore(catalog, {
          code: 'DAMAGED',
          label: 'Damaged',
          appliesTo: ['ADJUST'],
        }),
      ).toEqual({ ok: true });
      expect(
        await createReasonCodeCore(catalog, {
          code: 'DAMAGED',
          label: 'Again',
          appliesTo: ['ADJUST'],
        }),
      ).toEqual({
        ok: false,
        code: 'INVALID',
        message: 'Code DAMAGED is already used',
      });
      expect(
        await updateReasonCodeCore(catalog, 'DAMAGED', {
          label: 'Broken',
          appliesTo: ['ADJUST', 'PICK'],
        }),
      ).toEqual({ ok: true });
      expect(await listReasonCodesAdminCore(catalog)).toEqual([
        {
          code: 'DAMAGED',
          label: 'Broken',
          appliesTo: ['ADJUST', 'PICK'],
          system: false,
        },
      ]);
      expect(await listReasonCodesCore(catalog, 'PICK')).toEqual([
        { code: 'DAMAGED', label: 'Broken' },
      ]);
      expect(
        await updateReasonCodeCore(catalog, 'NOPE', {
          label: 'x',
          appliesTo: ['PICK'],
        }),
      ).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('rejects an unknown appliesTo value', async () => {
      await expect(
        createReasonCodeCore(catalog, {
          code: 'ODD',
          label: 'Odd',
          // @ts-expect-error deliberately invalid
          appliesTo: ['BOGUS'],
        }),
      ).rejects.toThrow();
      await expect(
        updateReasonCodeCore(catalog, 'ODD', {
          label: 'Odd',
          // @ts-expect-error deliberately invalid
          appliesTo: ['BOGUS'],
        }),
      ).rejects.toThrow();
    });

    it.each(['COUNT_AUTO', 'INITIAL'])(
      'system code %s cannot be changed',
      async (code) => {
        await catalog.reasonCode.create({
          data: { code, label: 'Sys', appliesTo: '["COUNT"]' },
        });
        const err = {
          ok: false,
          code: 'INVALID',
          message: "System reason codes can't be changed",
        };
        expect(
          await updateReasonCodeCore(catalog, code, {
            label: 'x',
            appliesTo: ['COUNT'],
          }),
        ).toEqual(err);
        expect(
          await createReasonCodeCore(catalog, {
            code,
            label: 'x',
            appliesTo: ['COUNT'],
          }),
        ).toEqual(err);
        const rows = await listReasonCodesAdminCore(catalog);
        expect(rows[0]).toMatchObject({ code, label: 'Sys', system: true });
      },
    );

    it('flags malformed appliesTo without throwing', async () => {
      await catalog.reasonCode.create({
        data: { code: 'BAD', label: 'Bad', appliesTo: '{' },
      });
      expect(await listReasonCodesAdminCore(catalog)).toEqual([
        {
          code: 'BAD',
          label: 'Bad',
          appliesTo: [],
          malformed: true,
          system: false,
        },
      ]);
    });
  });

  describe('authorization', () => {
    it('listProducts: supervisor ok, worker 403, no claims 401', async () => {
      expect(await handleListProducts(claims('supervisor'), {}, deps)).toEqual(
        [],
      );
      expect(await status(handleListProducts(claims('worker'), {}, deps))).toBe(
        403,
      );
      expect(await status(handleListProducts(null, {}, deps))).toBe(401);
    });

    it('admin can use every handler', async () => {
      const a = claims('admin');
      const c = await handleCreateCategory(
        a,
        { name: 'X', countTolerance: 1 },
        deps,
      );
      expect(await handleListCategories(a, {}, deps)).toHaveLength(1);
      expect(
        await handleUpdateCategory(
          a,
          { categoryId: c.id, name: 'Y', countTolerance: 2 },
          deps,
        ),
      ).toEqual({ ok: true });
      expect(await handleCreateProduct(a, prod(), deps)).toMatchObject({
        ok: true,
      });
      expect(
        await handleUpdateProduct(
          a,
          { productId: 'prod-a1', ...prod({ name: 'N' }) },
          deps,
        ),
      ).toEqual({ ok: true });
      expect(
        await handleCreateReasonCode(
          a,
          { code: 'ZZ', label: 'Z', appliesTo: ['MOVE'] },
          deps,
        ),
      ).toEqual({ ok: true });
      expect(
        await handleUpdateReasonCode(
          a,
          { code: 'ZZ', label: 'Z2', appliesTo: ['MOVE'] },
          deps,
        ),
      ).toEqual({ ok: true });
      expect(await handleListReasonCodesAdmin(a, {}, deps)).toHaveLength(1);
    });

    const calls: [string, (c: SessionClaims | null) => Promise<unknown>][] = [
      ['createProduct', (c) => handleCreateProduct(c, prod(), deps)],
      [
        'updateProduct',
        (c) => handleUpdateProduct(c, { productId: 'x', ...prod() }, deps),
      ],
      ['listCategories', (c) => handleListCategories(c, {}, deps)],
      [
        'createCategory',
        (c) => handleCreateCategory(c, { name: 'X', countTolerance: 0 }, deps),
      ],
      [
        'updateCategory',
        (c) =>
          handleUpdateCategory(
            c,
            { categoryId: 'x', name: 'X', countTolerance: 0 },
            deps,
          ),
      ],
      ['listReasonCodesAdmin', (c) => handleListReasonCodesAdmin(c, {}, deps)],
      [
        'createReasonCode',
        (c) =>
          handleCreateReasonCode(
            c,
            { code: 'ZZ', label: 'Z', appliesTo: ['MOVE'] },
            deps,
          ),
      ],
      [
        'updateReasonCode',
        (c) =>
          handleUpdateReasonCode(
            c,
            { code: 'ZZ', label: 'Z', appliesTo: ['MOVE'] },
            deps,
          ),
      ],
    ];
    it.each(calls)(
      '%s: supervisor and worker 403, no claims 401',
      async (_n, call) => {
        expect(await status(call(claims('supervisor')))).toBe(403);
        expect(await status(call(claims('worker')))).toBe(403);
        expect(await status(call(null))).toBe(401);
        expect(await catalog.product.count()).toBe(0);
      },
    );
  });
});
