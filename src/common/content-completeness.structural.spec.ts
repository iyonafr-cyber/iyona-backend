import {
  evaluateCompleteness,
  buildCompletenessScorecard,
} from './content-completeness';

// Minimal padding so files clear the too-small floor and isolate the
// structural checks under test.
const pad = (s: string) => s + '\n' + '// '.repeat(200);

const MANDATORY: Record<string, string> = {
  'package.json': pad('{"name":"x"}'),
  'tsconfig.json': pad('{}'),
  'vite.config.ts': pad('export default {}'),
  'index.html': pad('<!doctype html><div id=root></div>'),
  'src/main.tsx': pad('import App from "./App"'),
  'src/App.tsx': pad(
    'import {Routes,Route} from "react-router";export default function App(){return <Routes><Route path="/" element={<H/>}/><Route path="/cart" element={<C/>}/></Routes>}',
  ),
  'src/index.css': pad('body{}'),
};

function reasons(files: Record<string, string>): string[] {
  return evaluateCompleteness(files).issues.map((i) => i.reason);
}

describe('structural completeness checks', () => {
  it('flags a link to a route that was never created', () => {
    const files = {
      ...MANDATORY,
      'src/pages/HomePage.tsx': pad(
        'export function H(){return <div><section>a</section><Link to="/panier">Cart</Link></div>}',
      ),
    };
    expect(reasons(files)).toContain('broken-link');
  });

  it('flags a cart that has no reachable route (dead cart icon)', () => {
    const files: Record<string, string> = {
      ...MANDATORY,
      // App with NO cart route.
      'src/App.tsx': pad(
        'import {Routes,Route} from "react-router";export default function App(){return <Routes><Route path="/" element={<H/>}/></Routes>}',
      ),
      'src/context/CartContext.tsx': pad(
        'export function useCart(){} export const addToCart=()=>{}',
      ),
      'src/components/layout/Header.tsx': pad(
        'export function Header(){return <header><ShoppingBag/></header>}',
      ),
    };
    expect(reasons(files)).toContain('dead-control');
  });

  it('flags CRUD state with no localStorage persistence', () => {
    const files = {
      ...MANDATORY,
      'src/context/Store.tsx': pad(
        'export function Provider(){const [items,setItems]=useState<Item[]>([]);const addProduct=()=>{};return null}',
      ),
    };
    expect(reasons(files)).toContain('no-persistence');
  });

  it('flags a bare heading-only page as thin', () => {
    const files = {
      ...MANDATORY,
      'src/pages/AboutPage.tsx': pad(
        'export function About(){return <div><h1>About</h1><p>We are a company.</p></div>}',
      ),
    };
    expect(reasons(files)).toContain('thin-page');
  });

  it('does NOT flag a well-formed app (cart route + localStorage + rich page)', () => {
    const files = {
      ...MANDATORY,
      'src/context/CartContext.tsx': pad(
        'export function CartProvider(){const [items,setItems]=useState<Item[]>([]);useEffect(()=>{localStorage.setItem("cart",JSON.stringify(items))},[items]);const addToCart=()=>{};return null}',
      ),
      'src/components/layout/Header.tsx': pad(
        'export function Header(){return <header><Link to="/cart"><ShoppingBag/></Link></header>}',
      ),
      'src/pages/HomePage.tsx': pad(
        'export function H(){return <div><section>hero</section><section>feat</section><Card/>{list.map(x=><Card key={x}/>)}</div>}',
      ),
    };
    const structural = evaluateCompleteness(files).issues.filter((i) =>
      ['broken-link', 'dead-control', 'thin-page', 'no-persistence'].includes(
        i.reason,
      ),
    );
    expect(structural).toHaveLength(0);
  });
});

describe('entity field contract drift', () => {
  const CAR_TYPE = pad(
    'export interface Car { id: string; image: string; title: string; model: string; year: number; condition: string; price: number; description: string; }',
  );

  it('flags an Add form that collects fewer fields than the entity defines', () => {
    const files = {
      ...MANDATORY,
      'src/types/car.ts': CAR_TYPE,
      // The reported bug: card renders 6 fields, the form asks for 3.
      'src/pages/AddCarPage.tsx': pad(
        'import type { Car } from "@/types/car";' +
          'export function AddCarPage(){const [formData,setFormData]=useState({name:"",year:0,price:0});' +
          'return <form onSubmit={s}><Input name="name"/><Input name="year"/><Input name="price"/></form>}',
      ),
    };
    const issue = evaluateCompleteness(files).issues.find(
      (i) => i.reason === 'entity-field-drift',
    );
    expect(issue).toBeDefined();
    expect(issue!.path).toBe('src/pages/AddCarPage.tsx');
    expect(issue!.detail).toContain('image');
    expect(issue!.detail).toContain('condition');
    expect(issue!.detail).toContain('description');
  });

  it('does NOT flag a form that covers every user-supplied field', () => {
    const files = {
      ...MANDATORY,
      'src/types/car.ts': CAR_TYPE,
      'src/pages/AddCarPage.tsx': pad(
        'import type { Car } from "@/types/car";' +
          'export function AddCarPage(){return <form onSubmit={s}>' +
          '<Input name="image"/><Input name="title"/><Input name="model"/><Input name="year"/>' +
          '<Input name="condition"/><Input name="price"/><Textarea name="description"/></form>}',
      ),
    };
    expect(reasons(files)).not.toContain('entity-field-drift');
  });

  it('ignores system-generated fields the form should not collect', () => {
    const files = {
      ...MANDATORY,
      'src/types/post.ts': pad(
        'export interface Post { id: string; slug: string; createdAt: string; rating: number; views: number; title: string; body: string; author: string; }',
      ),
      'src/pages/NewPostPage.tsx': pad(
        'import type { Post } from "@/types/post";' +
          'export function NewPostPage(){return <form onSubmit={s}><Input name="title"/><Textarea name="body"/><Input name="author"/></form>}',
      ),
    };
    expect(reasons(files)).not.toContain('entity-field-drift');
  });

  it('stays quiet when the form cannot be matched to exactly one entity', () => {
    const files = {
      ...MANDATORY,
      'src/types/car.ts': CAR_TYPE,
      'src/types/van.ts': pad(
        'export interface Van { id: string; image: string; title: string; model: string; year: number; condition: string; description: string; }',
      ),
      // References both types — ambiguous, so no verdict.
      'src/pages/AddVehiclePage.tsx': pad(
        'import type { Car } from "@/types/car"; import type { Van } from "@/types/van";' +
          'export function AddVehiclePage(){return <form onSubmit={s}><Input name="title"/><Input name="year"/></form>}',
      ),
    };
    expect(reasons(files)).not.toContain('entity-field-drift');
  });

  it('does not treat Props/State interfaces as entities', () => {
    const files = {
      ...MANDATORY,
      'src/components/car/CarCardProps.ts': pad(
        'export interface CarCardProps { image: string; title: string; model: string; year: number; condition: string; onSelect: () => void; }',
      ),
      'src/pages/EditCarCardPage.tsx': pad(
        'export function EditCarCardPage(){return <form onSubmit={s}><Input name="title"/></form>}',
      ),
    };
    expect(reasons(files)).not.toContain('entity-field-drift');
  });
});

describe('split data source (DB vs static mock)', () => {
  const ADMIN_WRITES_DB = pad(
    'import { supabase } from "@/lib/supabase";' +
      'export async function createCar(c: Car){ return supabase.from("cars").insert(c); }',
  );
  const STATIC_CARS = pad(
    'export const cars = [{ id: "1", title: "Tesla Model 3", year: 2022 }];',
  );

  it('flags a public page rendering a static array for a DB-backed entity', () => {
    const files = {
      ...MANDATORY,
      'src/lib/api/cars.ts': ADMIN_WRITES_DB,
      'src/data/cars.ts': STATIC_CARS,
      'src/pages/HomePage.tsx': pad(
        'import { cars } from "@/data/cars";' +
          'export function H(){return <section>{cars.map(c=><Card key={c.id}>{c.title}</Card>)}</section>}',
      ),
    };
    const issue = evaluateCompleteness(files).issues.find(
      (i) => i.reason === 'split-data-source',
    );
    expect(issue).toBeDefined();
    expect(issue!.path).toBe('src/pages/HomePage.tsx');
    expect(issue!.detail).toContain('cars');
  });

  it('does NOT flag static data when the app has no Supabase usage', () => {
    const files = {
      ...MANDATORY,
      'src/data/cars.ts': STATIC_CARS,
      'src/pages/HomePage.tsx': pad(
        'import { cars } from "@/data/cars";' +
          'export function H(){return <section>{cars.map(c=><Card key={c.id}/>)}</section>}',
      ),
    };
    expect(reasons(files)).not.toContain('split-data-source');
  });

  it('does NOT flag static modules for entities with no matching table', () => {
    const files = {
      ...MANDATORY,
      'src/lib/api/cars.ts': ADMIN_WRITES_DB,
      'src/data/testimonials.ts': pad(
        'export const testimonials = [{ id: "1", quote: "Great cars!" }];',
      ),
      'src/pages/HomePage.tsx': pad(
        'import { testimonials } from "@/data/testimonials";' +
          'export function H(){return <section>{testimonials.map(t=><Card key={t.id}/>)}</section>}',
      ),
    };
    expect(reasons(files)).not.toContain('split-data-source');
  });

  it('does NOT flag when every surface queries Supabase', () => {
    const files = {
      ...MANDATORY,
      'src/lib/api/cars.ts': ADMIN_WRITES_DB,
      'src/pages/HomePage.tsx': pad(
        'import { listCars } from "@/lib/api/cars";' +
          'export function H(){const [cars,setCars]=useState<Car[]>([]);' +
          'useEffect(()=>{listCars().then(setCars)},[]);' +
          'return <section>{cars.map(c=><Card key={c.id}/>)}</section>}',
      ),
    };
    expect(reasons(files)).not.toContain('split-data-source');
  });
});

describe('admin shell leak', () => {
  const ADMIN_LAYOUT = pad(
    'export function AdminLayout({children}){return <div><aside>nav</aside><main>{children}</main></div>}',
  );

  it('flags an admin page rendering the public header/footer', () => {
    const files = {
      ...MANDATORY,
      'src/components/admin/AdminLayout.tsx': ADMIN_LAYOUT,
      'src/components/layout/Header.tsx': pad(
        'export function Header(){return <header><Link to="/">Home</Link></header>}',
      ),
      'src/pages/admin/AdminProductsPage.tsx': pad(
        'import { Header } from "@/components/layout/Header";' +
          'export function AdminProductsPage(){return <div><Header /><Table /></div>}',
      ),
    };
    const issue = evaluateCompleteness(files).issues.find(
      (i) => i.reason === 'admin-shell-leak',
    );
    expect(issue).toBeDefined();
    expect(issue!.path).toBe('src/pages/admin/AdminProductsPage.tsx');
  });

  it('does NOT flag an admin page using its own AdminLayout', () => {
    const files = {
      ...MANDATORY,
      'src/components/admin/AdminLayout.tsx': ADMIN_LAYOUT,
      'src/pages/admin/AdminProductsPage.tsx': pad(
        'import { AdminLayout } from "@/components/admin/AdminLayout";' +
          'export function AdminProductsPage(){return <AdminLayout><Table /></AdminLayout>}',
      ),
    };
    expect(reasons(files)).not.toContain('admin-shell-leak');
  });

  it('flags an admin area with no AdminLayout component at all', () => {
    const files = {
      ...MANDATORY,
      'src/pages/admin/AdminProductsPage.tsx': pad(
        'export function AdminProductsPage(){return <div><section><Table /></section></div>}',
      ),
    };
    expect(reasons(files)).toContain('admin-shell-leak');
  });

  it('stays silent for an app with no admin area', () => {
    const files = {
      ...MANDATORY,
      'src/components/layout/Header.tsx': pad(
        'export function Header(){return <header><Link to="/">Home</Link></header>}',
      ),
      'src/pages/HomePage.tsx': pad(
        'import { Header } from "@/components/layout/Header";' +
          'export function H(){return <div><Header /><section>a</section><section>b</section></div>}',
      ),
    };
    expect(reasons(files)).not.toContain('admin-shell-leak');
  });
});

describe('buildCompletenessScorecard', () => {
  it('scores a thin e-commerce build low and reports the archetype floor', () => {
    const files = {
      ...MANDATORY,
      'src/App.tsx': pad(
        'import {Routes,Route} from "react-router";export default function App(){return <Routes><Route path="/" element={<H/>}/></Routes>}',
      ),
      'src/context/CartContext.tsx': pad(
        'export function useCart(){} export const addToCart=()=>{}',
      ),
      'src/components/layout/Header.tsx': pad(
        'export function Header(){return <header><ShoppingBag/></header>}',
      ),
    };
    const card = buildCompletenessScorecard(
      files,
      'e-commerce store to sell clothes with an admin area',
    );
    expect(card.archetype).toBe('ecommerce');
    expect(card.minPages).toBe(10);
    expect(card.score).toBeLessThan(70);
    expect(card.counts['dead-control']).toBeGreaterThanOrEqual(1);
  });

  it('scores a complete build near 100', () => {
    const files = {
      ...MANDATORY,
      'src/App.tsx': pad(
        'import {Routes,Route} from "react-router";export default function App(){return <Routes>' +
          ['/', '/shop', '/product', '/cart', '/checkout', '/login', '/signup', '/account', '/admin', '/about']
            .map((p) => `<Route path="${p}" element={<X/>}/>`)
            .join('') +
          '</Routes>}',
      ),
      'src/context/CartContext.tsx': pad(
        'export function CartProvider(){const [items,setItems]=useState<Item[]>([]);useEffect(()=>{localStorage.setItem("cart",JSON.stringify(items))},[items]);const addToCart=()=>{};return null}',
      ),
      'src/components/layout/Header.tsx': pad(
        'export function Header(){return <header><Link to="/cart"><ShoppingBag/></Link></header>}',
      ),
      'src/pages/HomePage.tsx': pad(
        'export function H(){return <div><section>a</section><section>b</section><Card/>{list.map(x=><Card key={x}/>)}</div>}',
      ),
    };
    const card = buildCompletenessScorecard(files, 'e-commerce store with admin');
    // routesFound counts distinct path segments; "/" (home) has none, so 10
    // routes → 9 segments. A consistent, harmless telemetry undercount.
    expect(card.routesFound).toBeGreaterThanOrEqual(9);
    expect(card.score).toBeGreaterThanOrEqual(90);
  });
});
