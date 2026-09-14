/**
 * ドメイン名の語彙とローカル辞書（`domain/` 内でだけ使う共通部品）。
 *
 * research/04 §5.6 の「辞書はローカルに持つ／単語分割は動的計画法で」に従う。
 * 実行時のネットワークアクセスは無い。
 *
 * ※ architecture §2 のファイル一覧には無い追加ファイル。
 *   generator.ts（略語辞書）と score.ts（dictCoverage・単語分割）の両方が同じ語彙を必要とし、
 *   どちらかに置くと循環 import になるため切り出した。
 */

/**
 * 略語辞書（生成規則 ② `abbrev` 用・40 語以上）。
 * architecture §6 に列挙された語をすべて含む。
 */
export const ABBREVIATIONS: Readonly<Record<string, string>> = {
  synthetic: 'synth',
  memory: 'mem',
  intelligence: 'intel',
  engineering: 'eng',
  application: 'app',
  applications: 'apps',
  development: 'dev',
  infrastructure: 'infra',
  automation: 'auto',
  generative: 'gen',
  generation: 'gen',
  distributed: 'dist',
  computing: 'compute',
  protocol: 'proto',
  architecture: 'arch',
  environment: 'env',
  operations: 'ops',
  management: 'mgmt',
  network: 'net',
  networking: 'net',
  security: 'sec',
  language: 'lang',
  optimization: 'opt',
  evaluation: 'eval',
  configuration: 'config',
  observability: 'obs',
  orchestration: 'orch',
  performance: 'perf',
  repository: 'repo',
  specification: 'spec',
  documentation: 'docs',
  visualization: 'viz',
  authentication: 'auth',
  authorization: 'authz',
  administration: 'admin',
  simulation: 'sim',
  laboratory: 'lab',
  statistics: 'stats',
  analytics: 'analytics',
  database: 'db',
  interface: 'api',
  transformer: 'former',
  reinforcement: 'rl',
  retrieval: 'rag',
  embedding: 'embed',
  embeddings: 'embeds',
  inference: 'infer',
  quantization: 'quant',
  compression: 'compress',
  verification: 'verify',
  validation: 'valid',
  integration: 'integ',
  deployment: 'deploy',
  telemetry: 'tele',
  provisioning: 'provision',
  scheduling: 'sched',
  serverless: 'serverless',
};

/** 生成規則 ④ の接頭辞。 */
export const PREFIXES = ['get', 'try', 'use'] as const;
/** 生成規則 ⑤ の接尾辞。 */
export const SUFFIXES = ['hq', 'hub', 'labs', 'ai'] as const;
/** 生成規則 ⑥ で落とす末尾の一般語。 */
export const GENERIC_TAILS = ['ai', 'engine', 'system', 'framework', 'protocol', 'platform'] as const;

/**
 * 単語分割と dictCoverage に使う英語語彙。
 * 「ドメイン名に実際に出る語」に絞った実務用リスト（頻度順の網羅より運用のしやすさを優先）。
 */
export const ENGLISH_WORDS: readonly string[] = [
  // 一般名詞・動詞・形容詞
  'able', 'about', 'above', 'access', 'account', 'act', 'action', 'active', 'add', 'admin', 'advance',
  'after', 'agent', 'agents', 'agile', 'air', 'alert', 'align', 'all', 'alpha', 'always', 'ambient',
  'analysis', 'analytics', 'anchor', 'answer', 'any', 'app', 'apps', 'arc', 'arch', 'archive', 'area',
  'art', 'ask', 'aspect', 'asset', 'assist', 'atlas', 'atom', 'audio', 'audit', 'auto', 'avatar', 'away',
  'back', 'bag', 'balance', 'band', 'bank', 'bar', 'base', 'basic', 'batch', 'beam', 'bench', 'best',
  'beta', 'better', 'big', 'bin', 'bind', 'bio', 'bit', 'black', 'blend', 'blob', 'block', 'blog', 'blue',
  'board', 'body', 'bold', 'bolt', 'bond', 'book', 'boost', 'boot', 'border', 'bot', 'bots', 'bound',
  'box', 'brain', 'branch', 'brand', 'break', 'bridge', 'brief', 'bright', 'bring', 'broad', 'brown',
  'browse', 'brush', 'budget', 'build', 'builder', 'bulk', 'bundle', 'burst', 'bus', 'byte',
  'cache', 'call', 'calm', 'camp', 'can', 'canvas', 'cap', 'capital', 'card', 'care', 'carry', 'cart',
  'case', 'cast', 'catch', 'cause', 'cell', 'center', 'central', 'chain', 'chair', 'chalk', 'change',
  'channel', 'chart', 'chat', 'check', 'chip', 'choice', 'circle', 'city', 'civic', 'claim', 'clarity',
  'class', 'classic', 'clean', 'clear', 'click', 'client', 'climb', 'clinic', 'clip', 'clock', 'close',
  'cloud', 'club', 'cluster', 'coach', 'code', 'coder', 'coding', 'coil', 'coin', 'cold', 'collect',
  'color', 'combine', 'come', 'command', 'comment', 'commit', 'common', 'compact', 'company', 'compare',
  'compass', 'compile', 'complete', 'compose', 'compress', 'compute', 'concept', 'condition', 'config',
  'connect', 'console', 'consult', 'contact', 'content', 'context', 'control', 'cook', 'cool', 'copy',
  'core', 'corner', 'cost', 'count', 'course', 'cover', 'craft', 'crawl', 'create', 'credit', 'crew',
  'crisp', 'critic', 'cross', 'crowd', 'crux', 'cube', 'cue', 'curate', 'current', 'curve', 'custom',
  'cut', 'cycle',
  'daily', 'dash', 'data', 'date', 'deal', 'debug', 'deck', 'decode', 'deep', 'default', 'defend',
  'define', 'delta', 'demo', 'dense', 'deploy', 'depth', 'design', 'desk', 'detail', 'detect', 'dev',
  'device', 'diff', 'digital', 'direct', 'discover', 'dispatch', 'display', 'distill', 'dive', 'doc',
  'docs', 'domain', 'done', 'door', 'dot', 'double', 'down', 'draft', 'drag', 'draw', 'dream', 'drift',
  'drive', 'drop', 'dual', 'due', 'dust', 'dynamic',
  'each', 'eager', 'early', 'earn', 'engineer', 'engineering', 'earth', 'ease', 'east', 'easy', 'echo', 'edge', 'edit', 'editor',
  'effect', 'effort', 'elastic', 'element', 'elite', 'embed', 'emit', 'empire', 'enable', 'end', 'endless',
  'energy', 'engine', 'enter', 'entry', 'env', 'equal', 'error', 'escape', 'essence', 'eval', 'even',
  'event', 'ever', 'every', 'exact', 'exchange', 'exec', 'exit', 'expand', 'expert', 'explore', 'export',
  'express', 'extend', 'extra',
  'fabric', 'face', 'fact', 'factor', 'fair', 'fall', 'false', 'family', 'fan', 'fast', 'fault', 'feature',
  'feed', 'feel', 'fetch', 'few', 'field', 'file', 'fill', 'film', 'filter', 'final', 'find', 'fine',
  'finish', 'fire', 'firm', 'first', 'fit', 'fix', 'flag', 'flame', 'flash', 'flat', 'flex', 'flight',
  'flip', 'float', 'flow', 'fluid', 'flux', 'focus', 'fold', 'folio', 'follow', 'font', 'food', 'foot',
  'force', 'forge', 'fork', 'form', 'format', 'forth', 'forward', 'found', 'frame', 'free', 'fresh',
  'front', 'frost', 'fuel', 'full', 'fun', 'function', 'fund', 'fusion', 'future',
  'gain', 'game', 'gap', 'garden', 'gate', 'gather', 'gauge', 'gear', 'gem', 'gen', 'general', 'generate',
  'genesis', 'get', 'giant', 'gift', 'give', 'glass', 'glide', 'global', 'glow', 'goal', 'gold', 'good',
  'grab', 'grace', 'grade', 'grain', 'grand', 'grant', 'graph', 'grasp', 'great', 'green', 'grid', 'grip',
  'group', 'grow', 'growth', 'guard', 'guide', 'guild',
  'habit', 'half', 'hand', 'handle', 'happy', 'hard', 'harbor', 'harvest', 'hash', 'have', 'head', 'health',
  'heap', 'hear', 'heart', 'heat', 'help', 'here', 'hero', 'hidden', 'high', 'hint', 'hire', 'hit', 'hold',
  'hole', 'home', 'honest', 'hook', 'hope', 'horizon', 'host', 'hot', 'hour', 'house', 'hub', 'human',
  'hunt', 'hyper',
  'icon', 'idea', 'ideal', 'image', 'impact', 'import', 'improve', 'impulse', 'inbox', 'index', 'indigo',
  'infer', 'infra', 'ingest', 'init', 'inline', 'inner', 'input', 'insight', 'inspect', 'install',
  'instant', 'intel', 'intent', 'invent', 'invoke', 'iron', 'issue', 'item',
  'jet', 'job', 'join', 'joint', 'journal', 'journey', 'joy', 'judge', 'jump', 'junction', 'just',
  'keen', 'keep', 'kernel', 'key', 'kick', 'kind', 'kit', 'knot', 'know', 'knowledge',
  'lab', 'labs', 'lake', 'lamp', 'land', 'lane', 'lang', 'large', 'laser', 'last', 'late', 'latent',
  'launch', 'law', 'layer', 'layout', 'lead', 'leaf', 'lean', 'leap', 'learn', 'ledger', 'left', 'legacy',
  'legend', 'lens', 'less', 'lesson', 'let', 'level', 'lever', 'lift', 'light', 'like', 'limit', 'line',
  'link', 'liquid', 'list', 'listen', 'lite', 'live', 'load', 'local', 'lock', 'log', 'logic', 'long',
  'look', 'loop', 'loose', 'lore', 'lot', 'low', 'lower', 'luck', 'lucid', 'lumen',
  'machine', 'macro', 'made', 'magic', 'magnet', 'mail', 'main', 'major', 'make', 'maker', 'manage',
  'manifest', 'many', 'map', 'margin', 'mark', 'market', 'mass', 'master', 'match', 'material', 'matrix',
  'matter', 'max', 'maze', 'mean', 'measure', 'media', 'meet', 'mem', 'memo', 'memory', 'mend', 'mental',
  'menu', 'merge', 'mesh', 'message', 'meta', 'meter', 'method', 'metric', 'micro', 'mid', 'might',
  'migrate', 'mile', 'milestone', 'mind', 'mine', 'mini', 'minor', 'mint', 'minute', 'mirror', 'miss',
  'mission', 'mix', 'mobile', 'mock', 'modal', 'mode', 'model', 'modern', 'module', 'moment', 'money',
  'monitor', 'month', 'moon', 'more', 'morph', 'most', 'motion', 'motor', 'mount', 'move', 'multi',
  'muse', 'must', 'mutate',
  'name', 'narrow', 'native', 'natural', 'nature', 'near', 'neat', 'need', 'nest', 'net', 'network',
  'neural', 'never', 'new', 'news', 'next', 'nice', 'niche', 'night', 'nimble', 'node', 'noise', 'nomad',
  'none', 'noon', 'norm', 'normal', 'north', 'note', 'notion', 'nova', 'now', 'nudge', 'null', 'number',
  'object', 'observe', 'obtain', 'ocean', 'offer', 'office', 'offset', 'often', 'omni', 'once', 'onward',
  'open', 'operate', 'ops', 'opt', 'optic', 'option', 'orbit', 'order', 'organ', 'origin', 'other',
  'out', 'outer', 'outline', 'output', 'over', 'overlay', 'own', 'oxide',
  'pace', 'pack', 'packet', 'page', 'paint', 'pair', 'panel', 'paper', 'parallel', 'parse', 'part',
  'partner', 'party', 'pass', 'past', 'patch', 'path', 'pattern', 'pause', 'pay', 'peak', 'peer', 'pen',
  'people', 'perf', 'perform', 'period', 'permit', 'phase', 'phone', 'photo', 'phrase', 'pick', 'picture',
  'piece', 'pilot', 'pin', 'pipe', 'pipeline', 'pitch', 'pivot', 'place', 'plain', 'plan', 'plane',
  'planet', 'plant', 'plate', 'play', 'plot', 'plug', 'plus', 'pocket', 'point', 'polar', 'policy',
  'polish', 'poll', 'pool', 'port', 'portal', 'pose', 'position', 'post', 'power', 'practice', 'praise',
  'precise', 'predict', 'prefer', 'prefix', 'prepare', 'present', 'press', 'prevent', 'price', 'prime',
  'print', 'prior', 'prism', 'private', 'probe', 'problem', 'process', 'produce', 'product', 'profile',
  'program', 'progress', 'project', 'promise', 'prompt', 'proof', 'proto', 'provide', 'public', 'pulse',
  'punch', 'pure', 'purple', 'purpose', 'push', 'put', 'puzzle',
  'quality', 'quant', 'quarry', 'quartz', 'quest', 'question', 'queue', 'quick', 'quiet', 'quill', 'quota',
  'race', 'radar', 'radial', 'radio', 'rail', 'rain', 'raise', 'random', 'range', 'rank', 'rapid', 'rate',
  'ratio', 'reach', 'react', 'read', 'ready', 'real', 'realm', 'reason', 'rebase', 'recall', 'record',
  'recover', 'red', 'reduce', 'refer', 'refine', 'reflect', 'refresh', 'region', 'register', 'regular',
  'relate', 'relay', 'release', 'reliable', 'rely', 'remain', 'remote', 'remove', 'render', 'renew',
  'repair', 'repeat', 'replay', 'report', 'repo', 'request', 'require', 'rescue', 'research', 'reserve',
  'reset', 'resolve', 'resource', 'respond', 'rest', 'result', 'resume', 'retain', 'retro', 'return',
  'reveal', 'reverse', 'review', 'revise', 'reward', 'rich', 'ride', 'ridge', 'right', 'ring', 'rise',
  'risk', 'river', 'road', 'robot', 'rock', 'role', 'roll', 'room', 'root', 'rotate', 'round', 'route',
  'router', 'row', 'royal', 'rule', 'run', 'runtime', 'rush',
  'safe', 'sage', 'sail', 'salt', 'same', 'sample', 'sand', 'save', 'scale', 'scan', 'scene', 'schema',
  'scheme', 'school', 'scope', 'score', 'scout', 'scrape', 'screen', 'script', 'scroll', 'seal', 'search',
  'season', 'seat', 'second', 'secret', 'section', 'secure', 'seed', 'seek', 'segment', 'select', 'self',
  'sell', 'send', 'sense', 'sensor', 'sequence', 'serial', 'series', 'serve', 'server', 'service',
  'session', 'set', 'settle', 'setup', 'shade', 'shadow', 'shape', 'share', 'sharp', 'shed', 'sheet',
  'shelf', 'shell', 'shield', 'shift', 'shine', 'ship', 'shop', 'short', 'show', 'side', 'sight', 'sign',
  'signal', 'silent', 'silver', 'sim', 'simple', 'single', 'site', 'size', 'sketch', 'skill', 'sky',
  'slate', 'sleek', 'slice', 'slide', 'slim', 'slot', 'slow', 'small', 'smart', 'smooth', 'snap', 'social',
  'socket', 'soft', 'solar', 'solid', 'solve', 'some', 'sonic', 'soon', 'sort', 'soul', 'sound', 'source',
  'south', 'space', 'span', 'spark', 'speak', 'spec', 'speed', 'spell', 'spend', 'sphere', 'spin', 'spine',
  'spirit', 'split', 'spot', 'spread', 'spring', 'sprint', 'square', 'stack', 'staff', 'stage', 'stake',
  'stamp', 'stand', 'star', 'start', 'state', 'static', 'station', 'status', 'stay', 'steady', 'steam',
  'steel', 'stem', 'step', 'stick', 'still', 'stock', 'stone', 'stop', 'storage', 'store', 'storm',
  'story', 'stream', 'street', 'stretch', 'strict', 'strike', 'string', 'strong', 'struct', 'studio',
  'study', 'style', 'sub', 'subject', 'submit', 'subtle', 'succeed', 'such', 'sudden', 'sum', 'summary',
  'summit', 'sun', 'super', 'supply', 'support', 'sure', 'surface', 'surge', 'survey', 'swap', 'sweep',
  'swift', 'switch', 'symbol', 'sync', 'synth', 'system',
  'table', 'tag', 'tail', 'take', 'tale', 'talent', 'talk', 'tall', 'tap', 'target', 'task', 'taste',
  'teach', 'team', 'tech', 'tell', 'temp', 'tempo', 'tender', 'tensor', 'term', 'test', 'text', 'thread',
  'three', 'thrive', 'through', 'throw', 'thumb', 'tick', 'ticket', 'tide', 'tidy', 'tie', 'tier', 'tight',
  'tile', 'time', 'tiny', 'tip', 'title', 'today', 'token', 'tool', 'top', 'topic', 'torch', 'total',
  'touch', 'tough', 'tour', 'tower', 'town', 'trace', 'track', 'trade', 'traffic', 'trail', 'train',
  'trait', 'transfer', 'transit', 'trap', 'travel', 'tread', 'treat', 'tree', 'trend', 'trial', 'tribe',
  'trick', 'trigger', 'trim', 'trip', 'true', 'trust', 'truth', 'try', 'tube', 'tune', 'tunnel', 'turn',
  'twin', 'twist', 'type',
  'ultra', 'under', 'unify', 'union', 'unique', 'unit', 'unite', 'universe', 'unlock', 'until', 'update',
  'upgrade', 'uplift', 'upload', 'upper', 'urban', 'urge', 'usage', 'use', 'user', 'utility',
  'valid', 'value', 'vantage', 'vapor', 'variant', 'vault', 'vector', 'velocity', 'vendor', 'venture',
  'verify', 'verse', 'version', 'vertex', 'very', 'vessel', 'via', 'vibe', 'video', 'view', 'vigor',
  'virtual', 'vision', 'visual', 'vital', 'vivid', 'voice', 'void', 'volume', 'vote', 'voyage',
  'wake', 'walk', 'wall', 'want', 'warm', 'warn', 'wash', 'watch', 'water', 'wave', 'way', 'weather',
  'weave', 'web', 'week', 'weigh', 'weight', 'well', 'west', 'what', 'wheel', 'when', 'where', 'while',
  'white', 'whole', 'wide', 'width', 'wild', 'will', 'win', 'wind', 'window', 'wing', 'wire', 'wise',
  'wish', 'with', 'within', 'wonder', 'wood', 'word', 'work', 'worker', 'world', 'worth', 'wrap', 'write',
  'yard', 'year', 'yield', 'young', 'your', 'youth',
  'zenith', 'zero', 'zone', 'zoom',
  // 技術語・略語（新語のドメインで実際に出るもの）
  'agentic', 'algo', 'api', 'async', 'auth', 'authz', 'bench', 'binary', 'blockchain', 'buffer', 'bus',
  'byte', 'cli', 'codegen', 'compiler', 'concurrency', 'container', 'cortex', 'cpu', 'crypto', 'daemon',
  'dataset', 'db', 'debugger', 'diffusion', 'distill', 'dns', 'edge', 'embeds', 'encoder', 'endpoint',
  'entropy', 'eval', 'fetcher', 'firmware', 'flops', 'fusion', 'gateway', 'gpu', 'grpc', 'gradient',
  'hardware', 'hologram', 'http', 'inference', 'ingress', 'kernel', 'lambda', 'latency', 'lattice',
  'ledger', 'lidar', 'linter', 'llm', 'logits', 'mcp', 'mesh', 'middleware', 'migration', 'mlops',
  'multimodal', 'namespace', 'neuron', 'observability', 'ontology', 'orchestrator', 'parser', 'payload',
  'pipeline', 'plugin', 'polyfill', 'prompt', 'proxy', 'quantum', 'queue', 'quota', 'rag', 'raster',
  'realtime', 'registry', 'regression', 'replica', 'retrieval', 'robotics', 'runtime', 'sandbox',
  'scaffold', 'scheduler', 'sdk', 'semantic', 'serverless', 'shard', 'sidecar', 'simulator', 'snapshot',
  'socket', 'software', 'sparse', 'sqlite', 'stateful', 'stateless', 'storage', 'streaming', 'swarm',
  'synapse', 'syntax', 'telemetry', 'tensor', 'terminal', 'throughput', 'tooling', 'topology',
  'transformer', 'transpiler', 'tunnel', 'typing', 'validator', 'vectordb', 'virtualize', 'wasm',
  'guardrail', 'guardrails', 'copilot', 'harness', 'provenance', 'attestation', 'watermark',
  'webhook', 'workflow', 'workspace', 'zeroshot',
];

const WORD_SET = new Set(ENGLISH_WORDS);

/** 追加語彙（キーワードのトークン・略語・接頭/接尾辞）を混ぜた語彙集合を作る。 */
export function vocabularyWith(extra: readonly string[] = []): Set<string> {
  const set = new Set(WORD_SET);
  for (const w of extra) {
    const clean = w.toLowerCase().replace(/[^a-z]/g, '');
    if (clean.length >= 2) set.add(clean);
  }
  // 略語辞書は「元の語」と「略した語」の両方を語彙に入れる
  // （dictCoverage は「キーワード語・略語辞書・接頭/接尾辞で説明できる割合」・architecture §5.4）。
  for (const [full, abbr] of Object.entries(ABBREVIATIONS)) {
    set.add(full);
    set.add(abbr);
  }
  for (const p of PREFIXES) set.add(p);
  for (const s of SUFFIXES) set.add(s);
  return set;
}

export interface Segmentation {
  words: string[];
  /** 辞書語で説明できた文字数 / 全文字数（0〜1）。 */
  coverage: number;
}

/**
 * 動的計画法で最尤分割する（research/04 §5.6）。
 * 評価は「カバー文字数を最大化 → 分割数を最小化」。メモ化して指数時間を避ける。
 */
export function segment(sld: string, extra: readonly string[] = []): Segmentation {
  const s = sld.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return { words: [], coverage: 0 };
  const vocab = vocabularyWith(extra);
  const n = s.length;
  const MIN = 2;

  // best[i] = 位置 i までの最良解
  const best: { covered: number; parts: string[]; segments: number }[] = new Array(n + 1);
  best[0] = { covered: 0, parts: [], segments: 0 };

  for (let i = 1; i <= n; i += 1) {
    let cur: { covered: number; parts: string[]; segments: number } | null = null;
    for (let j = 0; j < i; j += 1) {
      const prev = best[j];
      if (!prev) continue;
      const piece = s.slice(j, i);
      const known = piece.length >= MIN && vocab.has(piece);
      const cand = {
        covered: prev.covered + (known ? piece.length : 0),
        parts: known ? [...prev.parts, piece] : prev.parts,
        segments: prev.segments + (known ? 1 : 0),
      };
      if (
        cur === null ||
        cand.covered > cur.covered ||
        (cand.covered === cur.covered && cand.segments < cur.segments)
      ) {
        cur = cand;
      }
    }
    best[i] = cur ?? { covered: 0, parts: [], segments: 0 };
  }

  const result = best[n];
  return { words: result.parts, coverage: n === 0 ? 0 : result.covered / n };
}
