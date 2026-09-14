/**
 * 一般語のブロックリスト。n-gram 抽出でこれらを含む句を落とす。
 *
 * 狙いは「もう知られている語」を候補から外すこと（architecture §5.3）。
 * 150 語以上（tests/unit/ngram.test.ts で件数を検査）。
 *
 * 判定は「句全体の一致」ではなく「トークン列の部分一致」。
 * 実測（2026-09-03）で `large language models` が候補の最上位に出た。
 * `large language` も `language model` も表にあるのに、3-gram 全体が表に無いので素通りしていた。
 * 語の並びを 1 つずつ列挙して塞ぐ運用は必ず漏れるので、含んでいたら落とす方式にする。
 */

/** 句全体・句の構成語として現れたら候補を捨てる一般語。 */
export const GENERIC_BLOCKLIST: readonly string[] = [
  // AI 一般
  'ai', 'llm', 'llms', 'chatgpt', 'gpt', 'gpts', 'machine learning', 'deep learning', 'neural network',
  'neural networks', 'language model', 'language models', 'large language', 'large language model',
  'generative ai', 'ai agent', 'ai agents', 'ai model', 'ai models', 'ai tool', 'ai tools', 'ai app',
  'foundation model', 'foundation models', 'transformer', 'transformers', 'fine tuning', 'prompt engineering',
  'artificial intelligence', 'machine intelligence', 'computer vision', 'natural language',
  'reinforcement learning', 'supervised learning', 'unsupervised learning', 'data science', 'big data',
  'data engineering', 'training data', 'inference time', 'model training', 'open weights', 'open model',
  'agentic ai', 'multi agent', 'agentic coding', 'coding agent', 'ai coding', 'small language model',
  'local first',
  // 技術一般
  'blockchain', 'cloud', 'cloud native', 'saas', 'paas', 'iaas', 'open source', 'source code', 'web app',
  'web apps', 'mobile app', 'mobile apps', 'operating system', 'file system', 'database', 'data base',
  'api', 'apis', 'rest api', 'graphql', 'microservice', 'microservices', 'serverless', 'container',
  'containers', 'kubernetes', 'devops', 'ci cd', 'unit test', 'unit tests', 'test suite', 'code review',
  'pull request', 'version control', 'software engineering', 'software development', 'web development',
  'front end', 'back end', 'full stack', 'design system', 'user interface', 'user experience',
  'command line', 'text editor', 'code editor', 'package manager', 'build system', 'static site',
  'single page', 'progressive web', 'server side', 'client side', 'edge computing', 'quantum computing',
  'internet of things', 'augmented reality', 'virtual reality', 'mixed reality', 'digital twin',
  'cyber security', 'zero trust', 'end to end', 'real time', 'low code', 'no code', 'self hosted',
  // 言語・ランタイム・フレームワーク名
  'python', 'javascript', 'typescript', 'rust', 'golang', 'ruby', 'php', 'swift', 'kotlin', 'scala',
  'haskell', 'elixir', 'clojure', 'perl', 'lua', 'dart', 'julia', 'react', 'vue', 'angular', 'svelte',
  'next js', 'nuxt', 'astro', 'remix', 'django', 'flask', 'fastapi', 'rails', 'laravel', 'spring boot',
  'node js', 'deno', 'bun', 'webpack', 'vite', 'babel', 'eslint', 'prettier', 'jest', 'pytest',
  'tensorflow', 'pytorch', 'keras', 'numpy', 'pandas', 'scikit learn', 'jupyter notebook',
  // OS・プラットフォーム
  'linux', 'windows', 'macos', 'android', 'ios', 'unix', 'debian', 'ubuntu', 'arch linux', 'raspberry pi',
  'docker image', 'virtual machine',
  // ビジネス・一般名詞
  'startup', 'startups', 'business model', 'venture capital', 'product market', 'market fit',
  'growth hacking', 'remote work', 'work from home', 'side project', 'side hustle', 'personal brand',
  'social media', 'content marketing', 'search engine', 'user growth', 'customer support', 'best practice',
  'best practices', 'case study', 'white paper', 'road map', 'tech stack', 'code base', 'tech debt',
  'technical debt', 'developer experience', 'time series', 'use case', 'use cases', 'first principles',
  'show hn', 'ask hn', 'hacker news', 'my new', 'new project', 'open letter', 'year in', 'this week',
  'lessons learned', 'deep dive', 'getting started', 'how to', 'part one', 'part two', 'a look',
  'the future', 'state of', 'the state', 'introducing the', 'we built', 'i built', 'built a',
  'what is', 'why i', 'how i', 'the end', 'and more', 'you need', 'need to', 'should know',
  // 研究論文で頻出の一般句
  'in context', 'zero shot', 'few shot', 'chain of', 'of thought', 'state of the art', 'empirical study',
  'systematic review', 'case report', 'novel approach', 'a survey', 'survey of', 'benchmark suite',
  'evaluation framework', 'experimental results', 'ablation study', 'human evaluation', 'error analysis',
  // 2026-09-03 の実測で候補上位に残った既知語と、HN のタイトル定型句。
  // ハイフン形も並べてあるが、トークン化で `-` は空白になるので実際に効くのは空白形
  // （どちらで書いても同じ判定になるよう、集合を作るときに正規化している）。
  'large language models', 'multi-agent', 'local-first', 'vector database', 'coding agents',
  'retrieval augmented', 'rag', 'mcp server', 'model context protocol', 'vibe coding',
  'context engineering', 'developer tools', 'fine-tuning', 'real-time', 'year old',
  'tell hn', 'launch hn',
];

/** 句の先頭・末尾に来たら候補を捨てるストップワード。 */
export const STOPWORDS: readonly string[] = [
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of', 'to', 'in', 'on', 'at', 'by',
  'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did', 'have',
  'has', 'had', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'not', 'no',
  'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'you', 'your', 'i', 'my', 'me', 'he', 'she',
  'they', 'them', 'their', 'his', 'her', 'who', 'what', 'when', 'where', 'why', 'how', 'which', 'all',
  'any', 'some', 'more', 'most', 'other', 'others', 'new', 'old', 'very', 'just', 'now', 'here', 'there',
  'about', 'into', 'over', 'under', 'again', 'once', 'only', 'also', 'than', 'too', 'so', 'up', 'out',
  'off', 'down', 'via', 'per', 'vs', 'versus', 'using', 'used', 'use', 'get', 'got', 'make', 'made',
  'like', 'let', 'lets', 'dont', 'doesnt', 'isnt', 'wont', 'cant',
];

/** 表と候補で書き方が違っても同じ判定になるよう、ハイフン・連続空白を潰す。 */
export function normalizeBlockPhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_SET = new Set(GENERIC_BLOCKLIST.map(normalizeBlockPhrase));
const STOPWORD_SET = new Set(STOPWORDS);

/**
 * 末尾の語の単純な複数形を単数に戻した形も作る。
 * 実運用で `large language model` は落ちるのに `large language models` が通ってしまったため、
 * 語尾だけを機械的に畳んで同じ扱いにする（列挙で追いかけると必ず漏れる）。
 */
function singularVariants(phrase: string): string[] {
  const words = phrase.split(' ');
  const last = words[words.length - 1];
  const out: string[] = [];
  const swap = (w: string): string => [...words.slice(0, -1), w].join(' ');
  if (last.endsWith('ies') && last.length > 4) out.push(swap(`${last.slice(0, -3)}y`));
  if (last.endsWith('es') && last.length > 3) out.push(swap(last.slice(0, -2)));
  if (last.endsWith('s') && !last.endsWith('ss') && last.length > 2) out.push(swap(last.slice(0, -1)));
  return out;
}

/** その句そのもの（単数形も見る）が表にあるか。 */
function hitsExactly(phrase: string): boolean {
  if (GENERIC_SET.has(phrase)) return true;
  return singularVariants(phrase).some((v) => GENERIC_SET.has(v));
}

/**
 * 表にある**2 語以上**の句を、トークン列の連続部分列として含むか。
 *
 * 1 語のブロック語（ai・cloud・react 等）を部分一致に含めると
 * `cloud sovereignty` のような残したい新語まで消えるので、そちらは
 * 「全トークンが一般語なら落とす」（ngram.ts の all-generic-tokens）に任せる。
 */
export function containsGenericPhrase(phrase: string): string | null {
  const tokens = normalizeBlockPhrase(phrase).split(' ').filter((t) => t.length > 0);
  for (let n = tokens.length; n >= 2; n -= 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      const sub = tokens.slice(i, i + n).join(' ');
      if (hitsExactly(sub)) return sub;
    }
  }
  return null;
}

export const isGenericPhrase = (phrase: string): boolean => {
  const p = normalizeBlockPhrase(phrase);
  if (hitsExactly(p)) return true;
  return containsGenericPhrase(p) !== null;
};
export const isStopword = (token: string): boolean => STOPWORD_SET.has(token.toLowerCase());

/** 句の中に一般語（単独で意味を持たない語）だけが並んでいないかの判定に使う。 */
export const genericTokens = (): Set<string> =>
  new Set(GENERIC_BLOCKLIST.map(normalizeBlockPhrase).filter((w) => !w.includes(' ')));
