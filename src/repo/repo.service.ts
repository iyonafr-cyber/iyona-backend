import { Injectable, Logger } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { DistributedLockService } from 'src/common/distributed-lock/distributed-lock.service';
import type { LockOptions } from 'src/common/distributed-lock/distributed-lock.service';

/** Result of creating a Jarvis-owned repo. */
export interface JarvisRepoInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  htmlUrl: string;
}

/** Result of a commit operation. */
export interface CommitResult {
  sha: string;
  url: string;
}

/** Result of creating a pull request. */
export interface PrResult {
  number: number;
  nodeId: string;
  url: string;
  headBranch: string;
}

/** Result of merging a pull request. */
export interface MergeResult {
  sha: string;
  merged: boolean;
}

/** Simple words used to suffix repo names, e.g. "todoapp-bee". */
const REPO_SUFFIX_WORDS = [
  'ace',
  'arc',
  'ash',
  'bay',
  'bee',
  'bow',
  'bud',
  'cay',
  'cod',
  'cog',
  'cup',
  'dew',
  'dim',
  'dip',
  'doe',
  'dot',
  'dye',
  'ear',
  'ebb',
  'egg',
  'elk',
  'elm',
  'eon',
  'era',
  'eve',
  'fen',
  'fig',
  'fin',
  'fir',
  'fly',
  'fog',
  'fur',
  'gem',
  'gin',
  'gnu',
  'ham',
  'hay',
  'hem',
  'hen',
  'hop',
  'hub',
  'hue',
  'hum',
  'ice',
  'ink',
  'inn',
  'ion',
  'ivy',
  'jam',
  'jar',
  'jet',
  'jot',
  'joy',
  'keg',
  'kin',
  'kit',
  'lab',
  'lap',
  'law',
  'lea',
  'lid',
  'lip',
  'log',
  'lox',
  'lug',
  'lux',
  'map',
  'mar',
  'mat',
  'mew',
  'mid',
  'mix',
  'mob',
  'mop',
  'mud',
  'mug',
  'nab',
  'nap',
  'net',
  'nib',
  'nip',
  'nod',
  'nor',
  'nun',
  'oar',
  'oat',
  'odd',
  'ode',
  'oil',
  'ore',
  'orb',
  'owl',
  'pad',
  'pan',
  'pap',
  'pat',
  'paw',
  'pea',
  'peg',
  'pen',
  'pew',
  'pie',
  'pig',
  'pin',
  'pit',
  'pod',
  'pop',
  'pot',
  'pun',
  'pup',
  'rag',
  'ram',
  'ran',
  'rat',
  'raw',
  'ray',
  'rib',
  'rid',
  'rim',
  'rip',
  'rob',
  'rod',
  'roe',
  'rot',
  'row',
  'rub',
  'rue',
  'rum',
  'run',
  'rut',
  'rye',
  'sac',
  'sag',
  'sap',
  'sat',
  'saw',
  'say',
  'sea',
  'set',
  'sew',
  'ski',
  'sky',
  'sod',
  'son',
  'sot',
  'sow',
  'soy',
  'spa',
  'spy',
  'sub',
  'sue',
  'sum',
  'sun',
  'sup',
  'tab',
  'tan',
  'tap',
  'tar',
  'tea',
  'ten',
  'tip',
  'toe',
  'ton',
  'top',
  'tot',
  'tub',
  'tug',
  'tun',
  'urn',
  'van',
  'vat',
  'vim',
  'wad',
  'war',
  'wax',
  'web',
  'wed',
  'wig',
  'win',
  'wit',
  'woe',
  'wok',
  'won',
  'wry',
  'yak',
  'yam',
  'yap',
  'yew',
  'zap',
  'zen',
  'apex',
  'arch',
  'aria',
  'atom',
  'axle',
  'bark',
  'barn',
  'base',
  'bask',
  'bead',
  'beam',
  'bear',
  'beat',
  'bend',
  'bird',
  'bite',
  'blip',
  'blob',
  'blur',
  'bolt',
  'bond',
  'bone',
  'boom',
  'boot',
  'brim',
  'burp',
  'byte',
  'calm',
  'camp',
  'cape',
  'card',
  'cart',
  'cave',
  'cell',
  'cent',
  'chip',
  'clam',
  'clap',
  'clay',
  'clip',
  'clue',
  'coal',
  'coat',
  'coil',
  'coin',
  'comb',
  'cone',
  'cool',
  'cope',
  'cord',
  'core',
  'cork',
  'corn',
  'cove',
  'crab',
  'crew',
  'crop',
  'cube',
  'curl',
  'damp',
  'dare',
  'dark',
  'dart',
  'dash',
  'data',
  'dawn',
  'deck',
  'deep',
  'deer',
  'demo',
  'desk',
  'dial',
  'disk',
  'dive',
  'dock',
  'dome',
  'door',
  'dorm',
  'dove',
  'down',
  'draw',
  'drip',
  'drop',
  'drum',
  'dual',
  'dune',
  'dusk',
  'dust',
  'echo',
  'edge',
  'emit',
  'epic',
  'even',
  'exit',
  'expo',
  'face',
  'fact',
  'fade',
  'fall',
  'fang',
  'fare',
  'farm',
  'fast',
  'fate',
  'feat',
  'feed',
  'feet',
  'felt',
  'fern',
  'file',
  'fill',
  'film',
  'find',
  'fire',
  'fish',
  'fist',
  'flag',
  'flap',
  'flaw',
  'flex',
  'flip',
  'flow',
  'foam',
  'fold',
  'folk',
  'fond',
  'font',
  'food',
  'fork',
  'form',
  'fort',
  'frog',
  'from',
  'fuel',
  'full',
  'fume',
  'fuse',
  'gale',
  'game',
  'gaze',
  'gear',
  'germ',
  'gild',
  'gilt',
  'gist',
  'glow',
  'glue',
  'goal',
  'gold',
  'golf',
  'gong',
  'gore',
  'graft',
  'gram',
  'grit',
  'gust',
  'gyre',
  'halo',
  'halt',
  'hare',
  'hark',
  'harm',
  'harp',
  'haze',
  'head',
  'heal',
  'heap',
  'heat',
  'heel',
  'herd',
  'hero',
  'hide',
  'hill',
  'hint',
  'hire',
  'hive',
  'hold',
  'hole',
  'home',
  'hook',
  'hope',
  'horn',
  'hull',
  'hunt',
  'hurt',
  'husk',
  'hymn',
  'icon',
  'idea',
  'idle',
  'inch',
  'iris',
  'isle',
  'itch',
  'jade',
  'jest',
  'join',
  'jump',
  'june',
  'junk',
  'just',
  'keen',
  'kelp',
  'kern',
  'kick',
  'kill',
  'kind',
  'king',
  'knit',
  'knob',
  'knot',
  'know',
  'lace',
  'lake',
  'lamp',
  'land',
  'lane',
  'lark',
  'last',
  'late',
  'lava',
  'lawn',
  'leaf',
  'lean',
  'leap',
  'left',
  'lens',
  'lien',
  'life',
  'lift',
  'lime',
  'line',
  'link',
  'lint',
  'lion',
  'list',
  'live',
  'load',
  'lock',
  'loft',
  'loop',
  'loss',
  'love',
  'lure',
  'lynx',
  'mace',
  'mail',
  'main',
  'make',
  'mall',
  'mane',
  'mark',
  'mars',
  'mast',
  'maze',
  'mead',
  'meal',
  'mean',
  'meat',
  'meet',
  'meld',
  'melt',
  'memo',
  'menu',
  'mesh',
  'mild',
  'mile',
  'mill',
  'mime',
  'mind',
  'mine',
  'mint',
  'mire',
  'mist',
  'mode',
  'mold',
  'mole',
  'monk',
  'moon',
  'moor',
  'more',
  'moss',
  'moth',
  'mule',
  'musk',
  'myth',
  'nail',
  'name',
  'nave',
  'neck',
  'need',
  'nest',
  'next',
  'node',
  'nook',
  'noon',
  'norm',
  'note',
  'nova',
  'null',
  'oath',
  'oboe',
  'okay',
  'open',
  'opus',
  'oval',
  'oven',
  'page',
  'pair',
  'pale',
  'pane',
  'park',
  'part',
  'past',
  'path',
  'peak',
  'pear',
  'peel',
  'peer',
  'perm',
  'pest',
  'pine',
  'pink',
  'pipe',
  'pixel',
  'plan',
  'play',
  'plot',
  'plow',
  'plum',
  'plus',
  'poem',
  'poll',
  'pond',
  'pool',
  'port',
  'pose',
  'post',
  'prey',
  'prop',
  'pull',
  'pump',
  'pure',
  'push',
  'quad',
  'quay',
  'race',
  'rack',
  'rail',
  'rain',
  'rake',
  'ramp',
  'rang',
  'rank',
  'read',
  'real',
  'reed',
  'reef',
  'reel',
  'rein',
  'rent',
  'rest',
  'rice',
  'rich',
  'ride',
  'ring',
  'rise',
  'risk',
  'rite',
  'road',
  'roam',
  'roar',
  'robe',
  'rock',
  'role',
  'roll',
  'roof',
  'root',
  'rope',
  'rose',
  'rout',
  'ruby',
  'rule',
  'rush',
  'rust',
  'safe',
  'sage',
  'sail',
  'sake',
  'salt',
  'same',
  'sand',
  'sane',
  'sang',
  'sank',
  'save',
  'scan',
  'seal',
  'seam',
  'seed',
  'seek',
  'seem',
  'seep',
  'self',
  'sell',
  'send',
  'shed',
  'shin',
  'ship',
  'shoe',
  'shop',
  'shot',
  'show',
  'shut',
  'sift',
  'silk',
  'sill',
  'silt',
  'sing',
  'sink',
  'site',
  'size',
  'skin',
  'skip',
  'slab',
  'slag',
  'slam',
  'slap',
  'slat',
  'slim',
  'slip',
  'slot',
  'slow',
  'slug',
  'snap',
  'snip',
  'snow',
  'soap',
  'sock',
  'soft',
  'soil',
  'sole',
  'soma',
  'song',
  'soot',
  'sort',
  'soul',
  'span',
  'spar',
  'spec',
  'sped',
  'spin',
  'spit',
  'spot',
  'spur',
  'stab',
  'stag',
  'star',
  'stay',
  'stem',
  'step',
  'stew',
  'stir',
  'stop',
  'stub',
  'stud',
  'suit',
  'swap',
  'sway',
  'swim',
  'sync',
  'tack',
  'tail',
  'tale',
  'tall',
  'tame',
  'tape',
  'task',
  'teal',
  'tear',
  'tell',
  'tend',
  'tent',
  'term',
  'test',
  'text',
  'than',
  'that',
  'then',
  'thin',
  'tide',
  'tier',
  'tile',
  'till',
  'time',
  'tint',
  'tire',
  'toga',
  'toll',
  'tomb',
  'tong',
  'tool',
  'tops',
  'tore',
  'torn',
  'town',
  'tram',
  'trap',
  'tree',
  'trim',
  'trip',
  'trod',
  'troy',
  'true',
  'tube',
  'tuft',
  'tune',
  'turf',
  'turn',
  'twin',
  'type',
  'ugly',
  'ulna',
  'unit',
  'upon',
  'vale',
  'vane',
  'vary',
  'vast',
  'veil',
  'vein',
  'vent',
  'verb',
  'vest',
  'vibe',
  'view',
  'vine',
  'void',
  'volt',
  'vote',
  'wade',
  'wage',
  'wake',
  'walk',
  'wall',
  'ward',
  'warm',
  'warp',
  'wart',
  'wave',
  'weak',
  'weal',
  'wear',
  'weed',
  'week',
  'well',
  'went',
  'west',
  'when',
  'whip',
  'wild',
  'will',
  'wind',
  'wine',
  'wing',
  'wire',
  'wise',
  'wish',
  'wolf',
  'wood',
  'wool',
  'word',
  'work',
  'worm',
  'wrap',
  'wren',
  'writ',
  'yard',
  'yarn',
  'year',
  'yell',
  'yoga',
  'yore',
  'zero',
  'zest',
  'zinc',
  'zone',
  'zoom',
];

/** Max file size fetched from GitHub trees (1 MiB). Larger blobs are skipped. */
const MAX_BLOB_BYTES = 1_048_576;

function pickRandomWord(): string {
  return REPO_SUFFIX_WORDS[
    Math.floor(Math.random() * REPO_SUFFIX_WORDS.length)
  ];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

@Injectable()
export class RepoService {
  private readonly logger = new Logger(RepoService.name);
  private readonly octokit: Octokit;
  /** GitHub org slug when using org-hosted repos; empty for PAT-under-user repos. */
  private readonly org: string;
  /** PAT-first: `GITHUB_PAT` overrides `JARVIS_GITHUB_TOKEN` when both are set. */
  private readonly authToken: string;
  private readonly useOrgRepos: boolean;
  private readonly configured: boolean;

  constructor(private readonly lock: DistributedLockService) {
    this.authToken =
      process.env.GITHUB_PAT?.trim() ||
      process.env.JARVIS_GITHUB_TOKEN?.trim() ||
      '';
    this.org = process.env.JARVIS_GITHUB_ORG?.trim() ?? '';
    this.useOrgRepos = this.org.length > 0;
    this.configured = this.authToken.length > 0;

    if (!this.configured) {
      this.logger.warn(
        'GITHUB_PAT or JARVIS_GITHUB_TOKEN is not set — GitHub repo operations will fail at runtime',
      );
    }

    // Octokit is always constructed; if token is empty, API calls will 401
    // and the lazy guard below will throw a descriptive error before that.
    this.octokit = new Octokit({ auth: this.authToken });
  }

  /** Throw a descriptive error if the service wasn't configured at startup. */
  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error(
        'RepoService is not configured: set GITHUB_PAT or JARVIS_GITHUB_TOKEN in the environment (set JARVIS_GITHUB_ORG only when creating repos under a GitHub org)',
      );
    }
  }

  // ── LOCKING ────────────────────────────────────────────────────────────────

  /**
   * Serialize operations for the same project ACROSS replicas. Cursor rounds
   * and user saves both acquire this lock so commits never race, even with more
   * than one Nest worker. Returns the result of `fn`; throws if `fn` throws, or
   * a 409 if the lock can't be acquired within the wait window.
   */
  async runExclusive<T>(
    projectId: string,
    fn: () => Promise<T>,
    options?: LockOptions,
  ): Promise<T> {
    return this.lock.runExclusive(`project:${projectId}`, fn, options);
  }

  // ── REPO LIFECYCLE ─────────────────────────────────────────────────────────

  /**
   * Create a Jarvis-owned repo named `{slug}-{word}` (private, auto_init).
   * When `JARVIS_GITHUB_ORG` is set: repo under that org. Otherwise: repo under
   * the authenticated PAT user (`POST /user/repos`).
   */
  async createProjectRepo(projectName: string): Promise<JarvisRepoInfo> {
    this.assertConfigured();
    const base = slugify(projectName || 'project');

    for (let attempt = 0; attempt < 5; attempt++) {
      const repoName = `${base}-${pickRandomWord()}`;
      try {
        if (this.useOrgRepos) {
          const { data } = await this.octokit.repos.createInOrg({
            org: this.org,
            name: repoName,
            private: true,
            auto_init: true,
            description: `Jarvis-generated project: ${projectName}`,
          });

          this.logger.log(`Created repo ${this.org}/${repoName}`);
          return {
            owner: this.org,
            repo: repoName,
            defaultBranch: data.default_branch ?? 'main',
            htmlUrl: data.html_url,
          };
        }

        const { data } = await this.octokit.repos.createForAuthenticatedUser({
          name: repoName,
          private: true,
          auto_init: true,
          description: `Jarvis-generated project: ${projectName}`,
        });

        const owner =
          typeof data.owner?.login === 'string'
            ? data.owner.login
            : (await this.octokit.users.getAuthenticated()).data.login;

        this.logger.log(`Created repo ${owner}/${repoName} (personal account)`);
        return {
          owner,
          repo: repoName,
          defaultBranch: data.default_branch ?? 'main',
          htmlUrl: data.html_url,
        };
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 422 && attempt < 4) {
          this.logger.warn(
            `Repo name ${repoName} taken, retrying (attempt ${attempt + 1})`,
          );
          continue;
        }
        throw err;
      }
    }

    throw new Error(
      `Failed to create repo for "${projectName}" after 5 attempts`,
    );
  }

  // ── BRANCH HELPERS ─────────────────────────────────────────────────────────

  async getBranchHead(
    owner: string,
    repo: string,
    branch = 'main',
  ): Promise<string> {
    this.assertConfigured();
    const { data } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return data.object.sha;
  }

  async waitForBranch(
    owner: string,
    repo: string,
    branch: string,
    timeoutMs = 120_000,
    intervalMs = 2_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      try {
        await this.octokit.repos.getBranch({ owner, repo, branch });
        return;
      } catch (e) {
        last = e instanceof Error ? e.message : String(e);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    throw new Error(
      `Timed out waiting for ${owner}/${repo}@${branch} via GitHub API: ${last}`,
    );
  }

  // ── TREE READ / WRITE ──────────────────────────────────────────────────────

  /**
   * Push a file map as a single commit on the given branch (default: main).
   * Creates the branch from the current HEAD if it does not exist yet.
   * Uses the GitHub Git Data API (no local git clone required).
   */
  async commitTree(
    owner: string,
    repo: string,
    files: Record<string, string>,
    message: string,
    branch = 'main',
  ): Promise<CommitResult> {
    this.assertConfigured();
    // Get current branch HEAD
    let parentSha: string;
    let baseTreeSha: string;

    try {
      const { data: refData } = await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      parentSha = refData.object.sha;
      const { data: commitData } = await this.octokit.git.getCommit({
        owner,
        repo,
        commit_sha: parentSha,
      });
      baseTreeSha = commitData.tree.sha;
    } catch {
      // Branch doesn't exist — get the default branch HEAD
      const { data: repoData } = await this.octokit.repos.get({ owner, repo });
      const { data: refData } = await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${repoData.default_branch}`,
      });
      parentSha = refData.object.sha;
      const { data: commitData } = await this.octokit.git.getCommit({
        owner,
        repo,
        commit_sha: parentSha,
      });
      baseTreeSha = commitData.tree.sha;
    }

    // Create blobs concurrently (capped at 8)
    const paths = Object.keys(files);
    const blobTasks = paths.map(
      (p) =>
        async (): Promise<{
          path: string;
          mode: '100644';
          type: 'blob';
          sha: string;
        }> => {
          const { data: blob } = await this.octokit.git.createBlob({
            owner,
            repo,
            content: Buffer.from(files[p] ?? '').toString('base64'),
            encoding: 'base64',
          });
          return {
            path: p.replace(/^\/+/, ''),
            mode: '100644',
            type: 'blob',
            sha: blob.sha,
          };
        },
    );
    const treeItems = await runConcurrent(blobTasks, 8);

    // Create tree
    const { data: treeData } = await this.octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeItems,
    });

    // Create commit
    const { data: commit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: treeData.sha,
      parents: [parentSha],
      author: {
        name: 'Jarvis AI',
        email: 'jarvis-ai@noreply.jarvis.build',
      },
    });

    // Update or create branch ref
    try {
      await this.octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: commit.sha,
      });
    } catch {
      await this.octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });
    }

    return {
      sha: commit.sha,
      url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    };
  }

  /**
   * Fetch the full file tree at a given commit SHA as a `Record<path, content>`.
   * Binary blobs and files >1 MiB are skipped.
   */
  async readTreeAtSha(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<Record<string, string>> {
    this.assertConfigured();
    const { data: tree } = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: sha,
      recursive: '1',
    });

    const blobs = tree.tree.filter(
      (item) =>
        item.type === 'blob' && item.path && (item.size ?? 0) <= MAX_BLOB_BYTES,
    );

    const fetchTasks = blobs.map(
      (item) => async (): Promise<{ path: string; content: string } | null> => {
        try {
          const { data } = await this.octokit.git.getBlob({
            owner,
            repo,
            file_sha: item.sha,
          });
          const raw =
            data.encoding === 'base64'
              ? Buffer.from(data.content, 'base64').toString('utf8')
              : data.content;
          return { path: item.path, content: raw };
        } catch (e) {
          this.logger.warn(`Skipping blob ${item.path}: ${e}`);
          return null;
        }
      },
    );

    const results = await runConcurrent(fetchTasks, 8);
    const out: Record<string, string> = {};
    for (const r of results) {
      if (r) out[r.path] = r.content;
    }
    return out;
  }

  /**
   * Fetch a single UTF-8 text file from a repo ref (branch name or SHA).
   * Returns `null` when the path is missing (404) or is not a file.
   */
  async getTextFile(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string | null> {
    this.assertConfigured();
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: path.replace(/^\/+/, ''),
        ref,
      });
      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }
      if ('content' in data && typeof data.content === 'string') {
        return Buffer.from(data.content, 'base64').toString('utf8');
      }
      return null;
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 404) return null;
      throw e;
    }
  }

  /**
   * Count blobs in a tree without fetching their content.
   * Used by the workspace deploy endpoint to get `fileCount` cheaply.
   */
  async getBlobCount(
    owner: string,
    repo: string,
    sha: string,
  ): Promise<number> {
    const { data: tree } = await this.octokit.git.getTree({
      owner,
      repo,
      tree_sha: sha,
      recursive: '1',
    });
    return tree.tree.filter((item) => item.type === 'blob').length;
  }

  /**
   * Commit only changed/deleted files as a delta on top of the current HEAD.
   * Much cheaper than `commitTree` for user workspace saves (1 changed file
   * out of 100 = 1 blob API call instead of 100).
   *
   * `changes` items with `deleted: true` remove the file from the tree.
   * Items with `content` add or overwrite that path.
   */
  async commitDelta(
    owner: string,
    repo: string,
    changes: Array<{ path: string; content?: string; deleted?: boolean }>,
    message: string,
    branch = 'main',
  ): Promise<CommitResult> {
    // Get base
    const { data: refData } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const parentSha = refData.object.sha;
    const { data: commitData } = await this.octokit.git.getCommit({
      owner,
      repo,
      commit_sha: parentSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // Build delta tree entries
    const treeEntries: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      sha?: string | null;
      content?: string;
    }> = [];

    for (const change of changes) {
      const path = change.path.replace(/^\/+/, '');
      if (!path) continue;

      if (change.deleted) {
        // Null sha deletes the file from the tree
        treeEntries.push({ path, mode: '100644', type: 'blob', sha: null });
      } else if (change.content !== undefined) {
        // Provide content directly (GitHub creates the blob internally)
        treeEntries.push({
          path,
          mode: '100644',
          type: 'blob',
          content: change.content,
        });
      }
    }

    if (treeEntries.length === 0) {
      // Nothing to commit — return current HEAD
      return {
        sha: parentSha,
        url: `https://github.com/${owner}/${repo}/commit/${parentSha}`,
      };
    }

    const { data: treeData } = await this.octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeEntries as Parameters<
        typeof this.octokit.git.createTree
      >[0]['tree'],
    });

    const { data: commit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: treeData.sha,
      parents: [parentSha],
      author: { name: 'Jarvis AI', email: 'jarvis-ai@noreply.jarvis.build' },
    });

    await this.octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });

    return {
      sha: commit.sha,
      url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    };
  }

  // ── PULL REQUEST HELPERS ───────────────────────────────────────────────────

  async createPr(
    owner: string,
    repo: string,
    head: string,
    base = 'main',
    title = 'Jarvis AI fix',
    body = '',
  ): Promise<PrResult> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      head,
      base,
      title,
      body,
      draft: false,
    });
    return {
      number: data.number,
      nodeId: data.node_id,
      url: data.html_url,
      headBranch: data.head.ref,
    };
  }

  /** Convert a draft PR to "ready for review" so GitHub allows merging. */
  async markPrReady(
    owner: string,
    repo: string,
    prNumber: number,
    nodeId: string,
  ): Promise<void> {
    // Try REST first (works when the API allows it)
    try {
      await this.octokit.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        draft: false,
        state: 'open',
      });
    } catch {
      /* fall through to GraphQL */
    }

    // GraphQL fallback (handles org-level draft restrictions)
    await this.markPrReadyGraphql(nodeId);
  }

  private async markPrReadyGraphql(nodeId: string): Promise<void> {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `mutation ($id: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $id }) {
            pullRequest { isDraft }
          }
        }`,
        variables: { id: nodeId },
      }),
    });
    const body = (await res.json()) as { errors?: { message: string }[] };
    if (!res.ok || body.errors?.length) {
      throw new Error(
        `GraphQL markPullRequestReadyForReview HTTP ${res.status}: ${JSON.stringify(body.errors ?? body)}`,
      );
    }
  }

  /**
   * Merge a pull request. Waits up to 8 attempts for the "draft" flag to clear.
   */
  async mergePr(
    owner: string,
    repo: string,
    prNumber: number,
    nodeId: string,
    method: 'squash' | 'merge' | 'rebase' = 'squash',
  ): Promise<MergeResult> {
    // Ensure the PR is not in draft state before merging
    for (let poll = 0; poll < 8; poll++) {
      const { data } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      if (!data.draft) break;
      if (poll === 3) {
        try {
          await this.markPrReady(owner, repo, prNumber, nodeId);
        } catch (e) {
          this.logger.warn(`markPrReady attempt failed: ${e}`);
        }
      }
      if (poll === 7) {
        throw new Error(
          `PR #${prNumber} is still draft after ready-for-review attempts`,
        );
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // Merge with retries for transient conflicts
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const { data } = await this.octokit.pulls.merge({
          owner,
          repo,
          pull_number: prNumber,
          merge_method: method,
        });
        return { sha: data.sha ?? '', merged: data.merged };
      } catch (err: unknown) {
        const msg = (
          err instanceof Error
            ? err.message
            : typeof err === 'string'
              ? err
              : JSON.stringify(err)
        ).toLowerCase();
        if (msg.includes('draft') && attempt < 7) {
          await this.markPrReady(owner, repo, prNumber, nodeId);
          await new Promise((r) => setTimeout(r, 2000 + attempt * 1500));
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Failed to merge PR #${prNumber} after 8 attempts`);
  }

  /**
   * Attempt to rebase `branch` onto `main` by fetching current `main` HEAD
   * and fast-forward updating the branch ref. This is a lightweight "rebase"
   * for branches that diverged only due to a squash merge on main (i.e. Cursor
   * made changes but another commit landed on main first).
   *
   * Returns false if the branch has genuine conflicts that need resolution.
   */
  async attemptRebaseOntoMain(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<boolean> {
    try {
      await this.octokit.repos.merge({
        owner,
        repo,
        base: branch,
        head: 'main',
        commit_message: `chore: sync ${branch} with main`,
      });
      return true;
    } catch (err: unknown) {
      const status =
        err &&
        typeof err === 'object' &&
        'status' in err &&
        typeof (err as { status?: unknown }).status === 'number'
          ? (err as { status: number }).status
          : undefined;
      // 409 = merge conflict; anything else is unexpected
      if (status === 409) return false;
      throw err;
    }
  }

  async closePr(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.update({
      owner,
      repo,
      pull_number: prNumber,
      state: 'closed',
    });
  }

  /** List open PRs from a specific head branch (owner:branch format). */
  async findOpenPrForBranch(
    owner: string,
    repo: string,
    headBranch: string,
  ): Promise<{ number: number; nodeId: string; url: string } | null> {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${headBranch}`,
      per_page: 5,
    });
    if (!data.length) return null;
    return {
      number: data[0].number,
      nodeId: data[0].node_id,
      url: data[0].html_url,
    };
  }
}
