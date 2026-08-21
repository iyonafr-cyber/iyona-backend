import {
  detectArchetype,
  ideaImpliesAuth,
  lintPlanAgainstArchetype,
  countPlanRoutes,
} from './app-archetypes';

describe('detectArchetype', () => {
  it('detects e-commerce from French clothing-store prompt', () => {
    expect(
      detectArchetype(
        'Crée moi un site de e-commerce pour vendre des vêtements et chaussures',
      ).id,
    ).toBe('ecommerce');
  });

  it.each([
    ['A personal portfolio for a photographer', 'portfolio'],
    ['A SaaS analytics dashboard for teams', 'saas'],
    ['A blog about cooking recipes', 'blog'],
    ['A booking site for a hair salon', 'booking'],
    ['A social network for gamers', 'community'],
  ])('detects %s → %s', (idea, id) => {
    expect(detectArchetype(idea).id).toBe(id);
  });

  it('falls back to marketing on weak/ambiguous signal', () => {
    expect(detectArchetype('a nice website for us').id).toBe('marketing');
  });
});

describe('ideaImpliesAuth', () => {
  it('is true when an admin/role area is implied (FR)', () => {
    expect(
      ideaImpliesAuth('avec une partie administrateur pour gérer les produits'),
    ).toBe(true);
  });
  it('is false for a plain marketing site', () => {
    expect(ideaImpliesAuth('a landing page for my bakery')).toBe(false);
  });
});

describe('lintPlanAgainstArchetype', () => {
  it('flags the missing screens of a thin 5-route e-commerce plan', () => {
    const arch = detectArchetype('e-commerce clothing store with admin');
    const thinBrief =
      '| / | Home | | | | /produits | Products | | | | /produits/:id | Detail | | | | /admin | Admin | | |';
    const res = lintPlanAgainstArchetype(thinBrief, arch, true);
    expect(res.ok).toBe(false);
    expect(res.missingPages.map((p) => p.key)).toEqual(
      expect.arrayContaining([
        'cart',
        'checkout',
        'login',
        'signup',
        'account',
      ]),
    );
    expect(res.missingAuth).toBe(true);
  });

  it('passes a complete e-commerce plan covering the manifest', () => {
    const arch = detectArchetype('e-commerce clothing store with admin');
    const fullBrief = [
      'Home storefront hero',
      'Shop catalog grid with filters route /shop',
      'Product detail /product/:id with gallery and variants',
      'Cart /cart with line items',
      'Checkout /checkout multi-step confirmation',
      'Login /login with demo credentials',
      'Signup /register',
      'Account /account order history',
      'Admin /admin dashboard products CRUD',
      'extra /about page',
      'extra /contact page',
    ].join('\n');
    const res = lintPlanAgainstArchetype(fullBrief, arch, true);
    expect(res.missingPages).toHaveLength(0);
    expect(res.missingAuth).toBe(false);
    expect(res.ok).toBe(true);
  });
});

describe('countPlanRoutes', () => {
  it('counts distinct routes and ignores file paths', () => {
    const brief =
      'routes: /, /shop, /shop/:id, /cart. files: src/App.tsx, src/pages/Home.tsx';
    expect(countPlanRoutes(brief)).toBe(4);
  });
});
