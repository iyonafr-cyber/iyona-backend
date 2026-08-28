/**
 * Curated stock-image library for generated sites.
 *
 * WHY THIS EXISTS: the pipeline needs image URLs that BOTH load and MATCH the
 * product domain. The two failure modes it replaces:
 *   1. `source.unsplash.com/?<keyword>` — topical but the endpoint is
 *      deprecated and now 404s (broken-image icons everywhere).
 *   2. `picsum.photos/seed/<slug>` — always loads but the seed only pins WHICH
 *      random photo, not the subject, so a barber shop got nature/swimming
 *      imagery.
 *
 * Every URL below is a real Unsplash CDN asset that was fetched (HTTP 200) and
 * visually verified to show the labeled subject before being added. The
 * library is injected into the plan prompt AND the build-agent prompt as the
 * ONLY permitted `images.unsplash.com` ids; anything else is treated as a
 * guessed id (the usual broken-image cause).
 *
 * Keep this list curated and verified — never add an id you have not fetched
 * and looked at.
 */

export interface StockImage {
  /** Unsplash photo id, e.g. "photo-1503951914875-452162b0f3f1". */
  id: string;
  /** What the photo actually shows (visually verified). */
  alt: string;
}

export interface StockTopic {
  id: string;
  /** Human label used in the prompt block. */
  label: string;
  /** Matched against the project idea text (case-insensitive). */
  match: RegExp;
  images: StockImage[];
}

/** Render an Unsplash CDN URL at a given width. Height follows the original
 *  aspect unless callers append `&h=<n>` themselves. */
export const stockImageUrl = (id: string, width = 1600): string =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=80`;

export const STOCK_TOPICS: StockTopic[] = [
  {
    id: 'barber',
    label: 'Barber / hair salon / grooming',
    match:
      /\bbarber|salon|hair(cut|dress|style)?|coiffeur|coiffure|grooming\b/i,
    images: [
      { id: 'photo-1503951914875-452162b0f3f1', alt: 'barber shaving a client, moody barbershop light' },
      { id: 'photo-1585747860715-2ba37e788b70', alt: 'classic barbershop interior, chairs and mirrors' },
      { id: 'photo-1599351431202-1e0f0137899a', alt: 'barber doing a precision fade with razor' },
      { id: 'photo-1622286342621-4bd786c2447c', alt: 'barber cutting hair, over-the-shoulder view' },
      { id: 'photo-1605497788044-5a32c7078486', alt: 'barber blow-drying client in modern shop' },
      { id: 'photo-1560066984-138dadb4c035', alt: 'bright minimalist salon interior, black & white' },
      { id: 'photo-1562322140-8baeececf3df', alt: 'stylist blow-drying a seated client' },
    ],
  },
  {
    id: 'coffee',
    label: 'Coffee shop / café',
    match: /\bcoffee|caf[ée]|espresso|barista|roaster|roastery|tea ?house\b/i,
    images: [
      { id: 'photo-1495474472287-4d71bcdd2085', alt: 'three coffees held together, latte art, top-down' },
      { id: 'photo-1501339847302-ac426a4a7cbb', alt: 'café interior with glowing CAFE sign' },
      { id: 'photo-1554118811-1e0d58224f24', alt: 'spacious plant-filled café interior with seating' },
      { id: 'photo-1509042239860-f550ce710b93', alt: 'flat whites with latte art among plants' },
      { id: 'photo-1447933601403-0c6688de566e', alt: 'roasted coffee beans, full-frame texture' },
      { id: 'photo-1442512595331-e89e73853f31', alt: 'pour-over coffee being brewed, kettle' },
    ],
  },
  {
    id: 'food',
    label: 'Restaurant / food',
    match:
      /\brestaurant|food|dining|menu|chef|cuisine|bistro|pizz|bakery|boulangerie|catering|burger|sushi|taco|deli\b/i,
    images: [
      { id: 'photo-1517248135467-4c7edcad34c4', alt: 'upscale restaurant dining room, dark interior' },
      { id: 'photo-1414235077428-338989a2e8c0', alt: 'fine-dining plated dish with wine glasses' },
      { id: 'photo-1504674900247-0877df9cc836', alt: 'spread of plated dishes, top-down' },
      { id: 'photo-1555396273-367ea4eb4db5', alt: 'industrial-chic restaurant interior, daylight' },
      { id: 'photo-1467003909585-2f8a72700288', alt: 'salmon entrée close-up, restaurant table' },
      { id: 'photo-1546069901-ba9599a7e63c', alt: 'healthy grain bowl on neutral background' },
    ],
  },
  {
    id: 'fitness',
    label: 'Gym / fitness / sport',
    match:
      /\bgym|fitness|workout|training|yoga|pilates|crossfit|athlet|coach(ing)?|sport\b/i,
    images: [
      { id: 'photo-1534438327276-14e5300c3a48', alt: 'gym interior, dumbbell rack in foreground' },
      { id: 'photo-1571019613454-1cb2f99b2d8b', alt: 'woman doing crunches on a mat, daylight' },
      { id: 'photo-1517836357463-d25dfeac3438', alt: 'athlete gripping a barbell, deadlift setup' },
      { id: 'photo-1583454110551-21f2fa2afe61', alt: 'lifter picking dumbbells off a rack, close-up' },
      { id: 'photo-1541534741688-6078c6bfb5c5', alt: 'woman at squat rack, gritty gym wall' },
    ],
  },
  {
    id: 'office',
    label: 'SaaS / tech / office / agency',
    match:
      /\bsaas|software|startup|tech|agency|consult|b2b|dashboard|analytics|marketing|finance|fintech|coworking|office|crm|platform\b/i,
    images: [
      { id: 'photo-1522071820081-009f0129c71c', alt: 'team working on laptops around a wood table' },
      { id: 'photo-1497366216548-37526070297c', alt: 'modern minimal office corridor, dark walls' },
      { id: 'photo-1552664730-d307ca884978', alt: 'workshop: person at whiteboard with sticky notes' },
      { id: 'photo-1531482615713-2afd69097998', alt: 'two colleagues pair-working at a laptop' },
      { id: 'photo-1460925895917-afdab827c52f', alt: 'laptop showing analytics dashboard charts' },
      { id: 'photo-1498050108023-c5249f4df085', alt: 'laptop with code editor on a clean desk' },
    ],
  },
  {
    id: 'fashion',
    label: 'Fashion / clothing / retail',
    match:
      /\bfashion|clothing|apparel|boutique|wear|garment|sneaker|shoe|jewel|accessor|thrift|vintage store\b/i,
    images: [
      { id: 'photo-1441986300917-64674bd600d8', alt: 'menswear boutique interior, shelving display' },
      { id: 'photo-1445205170230-053b83016050', alt: 'neutral-tone garments on a storefront rack' },
      { id: 'photo-1483985988355-763728e1935b', alt: 'woman with shopping bags, sunglasses' },
      { id: 'photo-1490481651871-ab68de25d43d', alt: 'airy clothes rack with light dresses' },
      { id: 'photo-1523381210434-271e8be1f52b', alt: 'green t-shirts on wooden hangers, close-up' },
    ],
  },
  {
    id: 'interior',
    label: 'Real estate / interior / architecture',
    match:
      /\breal ?estate|immobilier|property|interior|furniture|architect|home|house|apartment|decor|renovation|construction\b/i,
    images: [
      { id: 'photo-1600585154340-be6161a56a0c', alt: 'modern house exterior at dusk, lawn' },
      { id: 'photo-1600607687939-ce8a6c25118c', alt: 'open-plan living room, grey sofa, wood wall' },
      { id: 'photo-1586023492125-27b2c045efd7', alt: 'yellow armchair against minimal wall, art' },
      { id: 'photo-1600566753086-00f18fb6b3ea', alt: 'bright living room with staircase and dog' },
      { id: 'photo-1512917774080-9991f1c4c750', alt: 'white villa with pool, blue sky' },
    ],
  },
  {
    id: 'spa',
    label: 'Spa / wellness / beauty',
    match: /\bspa|massage|wellness|skincare|esthetic|beauty|facial|nails?\b/i,
    images: [
      { id: 'photo-1544161515-4ab6ce6db874', alt: 'massage oil being poured, spa treatment' },
      { id: 'photo-1540555700478-4be289fbecef', alt: 'spa still life: towel, dispenser, tulips' },
    ],
  },
  {
    id: 'auto',
    label: 'Cars / automotive',
    match:
      /\bcar|auto(motive)?|vehicle|garage|dealership|detailing|moto(rcycle)?|rental\b/i,
    images: [
      { id: 'photo-1503376780353-7e6692767b70', alt: 'black sports sedan driving, motion blur' },
      { id: 'photo-1492144534655-ae79c964c9d7', alt: 'white muscle car in a workshop, lifts behind' },
      { id: 'photo-1553440569-bcc63803a83d', alt: 'red sports car on a forest road' },
    ],
  },
  {
    id: 'travel',
    label: 'Travel / outdoors / nature',
    match:
      /\btravel|tour(ism)?|outdoor|hik(e|ing)|camp(ing)?|nature|adventure|resort|beach|mountain\b/i,
    images: [
      { id: 'photo-1506905925346-21bda4d32df4', alt: 'snowy peaks above a sea of clouds at sunset' },
      { id: 'photo-1507525428034-b723cf961d3e', alt: 'tropical beach shoreline at golden hour' },
      { id: 'photo-1469474968028-56623f02e42e', alt: 'sunbeams over green mountain landscape' },
    ],
  },
  // Always-on topics (not keyword-matched): portraits + abstract backdrops.
  {
    id: 'people',
    label: 'People / portraits (testimonials, team, about)',
    match: /$^/,
    images: [
      { id: 'photo-1494790108377-be9c29b29330', alt: 'portrait: laughing woman in red top' },
      { id: 'photo-1507003211169-0a1dd7228f2d', alt: 'portrait: smiling man in white v-neck' },
      { id: 'photo-1500648767791-00dcc994a43e', alt: 'portrait: man in grey sweater, studio' },
      { id: 'photo-1438761681033-6461ffad8d80', alt: 'portrait: red-haired woman by a lake' },
      { id: 'photo-1472099645785-5658abf4ff4e', alt: 'portrait: older man with glasses, studio' },
      { id: 'photo-1544005313-94ddf0286df2', alt: 'portrait: long-haired woman at sunset' },
    ],
  },
  {
    id: 'abstract',
    label: 'Abstract gradients (decorative backgrounds ONLY)',
    match: /$^/,
    images: [
      { id: 'photo-1557683316-973673baf926', alt: 'teal-to-indigo smooth gradient' },
      { id: 'photo-1550859492-d5da9d8e45f3', alt: 'holographic multicolour blur' },
      { id: 'photo-1618005182384-a83a8bd57fbe', alt: 'purple/blue 3D fluid waves' },
      { id: 'photo-1557682250-33bd709cbe85', alt: 'blue-to-magenta smooth gradient' },
    ],
  },
];

const ALWAYS_TOPIC_IDS = ['people', 'abstract'];
const MAX_MATCHED_TOPICS = 3;

/**
 * The topics relevant to a project idea: every keyword-matched topic (capped)
 * plus the always-on portrait/abstract sets. Falls back to the office topic
 * when nothing matches, so the block never ships without a usable hero image.
 */
export function stockTopicsForIdea(idea: string): StockTopic[] {
  const text = idea || '';
  const matched = STOCK_TOPICS.filter(
    (t) => !ALWAYS_TOPIC_IDS.includes(t.id) && t.match.test(text),
  ).slice(0, MAX_MATCHED_TOPICS);
  if (matched.length === 0) {
    matched.push(STOCK_TOPICS.find((t) => t.id === 'office')!);
  }
  const always = STOCK_TOPICS.filter((t) => ALWAYS_TOPIC_IDS.includes(t.id));
  return [...matched, ...always];
}

/**
 * Render the VERIFIED IMAGE LIBRARY prompt block for a project idea. Injected
 * into both the plan prompt (so the brain assigns these URLs in seed data) and
 * the build-agent prompt (so the worker never substitutes guessed ids).
 */
export function stockImageBlockForIdea(idea: string): string {
  const topics = stockTopicsForIdea(idea);
  const lines: string[] = [
    'VERIFIED IMAGE LIBRARY (every URL below is confirmed to load AND labeled with what it shows — these are the ONLY images.unsplash.com assets you may use):',
  ];
  for (const topic of topics) {
    lines.push(`${topic.label}:`);
    for (const img of topic.images) {
      lines.push(`  - ${stockImageUrl(img.id)} — ${img.alt}`);
    }
  }
  lines.push(
    'Usage: pick images whose LABEL matches what the surface shows — a barber page gets barbering imagery, a testimonial gets a portrait; never use a photo whose label is unrelated to the section. Reuse library images across pages and request other sizes by changing `w=` (e.g. w=800 for cards, w=400 for thumbs). For entity seed data that needs MORE distinct images than the library has, cycle through the topic list rather than inventing new ids.',
  );
  return lines.join('\n');
}
