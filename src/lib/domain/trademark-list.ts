/**
 * 既知の企業・サービス・ブランド名のブロックリスト。
 *
 * 目的は「商標に触れそうな候補を候補一覧から外す」ことだけ。
 * **抵触の有無を判定するものではない**（自動判定は不可能・research/04 §4）。
 * 除外された理由は UI に出し、残った候補にも常に `Trademark check required` を出す。
 *
 * 小文字・スペース区切りで書く。300 語以上（tests/unit/trademark.test.ts で件数を検査）。
 */
export const TRADEMARK_BLOCKLIST: readonly string[] = [
  // --- プラットフォーム・クラウド ---
  'google', 'alphabet', 'youtube', 'gmail', 'android', 'chrome', 'chromium', 'gemini', 'deepmind',
  'firebase', 'bigquery', 'vertex ai', 'google cloud', 'gcp', 'looker', 'waymo', 'fitbit', 'nest',
  'apple', 'iphone', 'ipad', 'macbook', 'imac', 'macos', 'ios', 'ipados', 'watchos', 'airpods',
  'icloud', 'siri', 'safari', 'xcode', 'swiftui', 'testflight', 'apple pay', 'vision pro',
  'microsoft', 'windows', 'azure', 'office', 'excel', 'powerpoint', 'onedrive', 'outlook', 'sharepoint',
  'teams', 'copilot', 'github', 'dotnet', 'visual studio', 'vscode', 'bing', 'xbox', 'linkedin', 'skype',
  'amazon', 'aws', 'kindle', 'alexa', 'prime video', 'twitch', 'audible', 'lambda labs', 'cloudfront',
  'dynamodb', 'redshift', 'sagemaker', 'bedrock', 'ec2', 'route53',
  'meta', 'facebook', 'instagram', 'whatsapp', 'messenger', 'oculus', 'llama', 'react native', 'threads',
  'oracle', 'java', 'mysql', 'salesforce', 'slack', 'tableau', 'heroku', 'mulesoft', 'sap', 'ibm',
  'watson', 'red hat', 'openshift', 'ansible', 'fedora', 'ubuntu', 'canonical', 'suse', 'debian',
  'vmware', 'nutanix', 'citrix', 'dell', 'hewlett packard', 'lenovo', 'asus', 'acer', 'toshiba',
  // --- AI ---
  'openai', 'chatgpt', 'dall e', 'sora', 'whisper', 'codex', 'anthropic', 'claude', 'sonnet cli',
  'mistral', 'cohere', 'perplexity', 'midjourney', 'stability ai', 'stable diffusion', 'runway',
  'huggingface', 'hugging face', 'replicate', 'together ai', 'groq', 'cerebras', 'nvidia', 'cuda',
  'tensorrt', 'omniverse', 'jetson', 'amd', 'radeon', 'intel', 'xeon', 'arm holdings', 'qualcomm',
  'snapdragon', 'broadcom', 'tsmc', 'samsung', 'elevenlabs', 'suno', 'udio', 'luma ai', 'pika labs',
  'character ai', 'inflection ai', 'scale ai', 'databricks', 'snowflake', 'palantir', 'c3 ai',
  'langchain', 'llamaindex', 'pinecone', 'weaviate', 'chroma db', 'qdrant', 'milvus', 'wandb',
  // --- 開発ツール・インフラ ---
  'docker', 'kubernetes', 'helm charts', 'terraform', 'hashicorp', 'vault by hashicorp', 'consul',
  'nomad', 'packer', 'vagrant', 'jenkins', 'circleci', 'travis ci', 'gitlab', 'bitbucket', 'atlassian',
  'jira', 'confluence', 'trello', 'bamboo', 'sourcetree', 'sentry', 'datadog', 'new relic', 'splunk',
  'elastic', 'elasticsearch', 'kibana', 'logstash', 'grafana', 'prometheus', 'nginx', 'apache',
  'cloudflare', 'workers ai', 'fastly', 'akamai', 'digitalocean', 'linode', 'vultr', 'hetzner',
  'vercel', 'netlify', 'render com', 'railway app', 'fly io', 'supabase', 'planetscale', 'neon tech',
  'mongodb', 'atlas search', 'redis', 'postgresql', 'mariadb', 'cockroachdb', 'clickhouse', 'duckdb',
  'sqlite', 'kafka', 'rabbitmq', 'airflow', 'dbt labs', 'fivetran', 'segment', 'mixpanel', 'amplitude',
  'launchdarkly', 'pagerduty', 'opsgenie', 'twilio', 'sendgrid', 'mailchimp', 'mailgun', 'postmark',
  'resend', 'stripe', 'paypal', 'square', 'adyen', 'plaid', 'wise', 'revolut', 'coinbase', 'binance',
  'kraken', 'metamask', 'opensea', 'ethereum', 'bitcoin', 'solana', 'polygon labs', 'chainlink',
  // --- SaaS・業務 ---
  'notion', 'figma', 'canva', 'miro', 'airtable', 'asana', 'monday com', 'clickup', 'basecamp', 'zapier',
  'make com', 'ifttt', 'retool', 'webflow', 'wordpress', 'automattic', 'shopify', 'wix', 'squarespace',
  'bigcommerce', 'magento', 'woocommerce', 'hubspot', 'marketo', 'pardot', 'zendesk', 'intercom',
  'freshworks', 'servicenow', 'workday', 'okta', 'auth0', 'onelogin', 'duo security', 'jamf', 'zoom',
  'webex', 'gotomeeting', 'dropbox', 'box com', 'egnyte', 'docusign', 'adobe', 'photoshop', 'illustrator',
  'premiere pro', 'after effects', 'lightroom', 'acrobat', 'autodesk', 'autocad', 'maya', 'blender org',
  'unity technologies', 'unreal engine', 'epic games', 'godot engine', 'roblox', 'steam', 'valve',
  // --- 消費者・小売・ブランド ---
  'netflix', 'spotify', 'disney', 'hulu', 'hbo', 'paramount', 'warner bros', 'universal', 'sony',
  'playstation', 'nintendo', 'sega', 'bandai', 'capcom', 'square enix', 'konami', 'ea sports',
  'activision', 'blizzard', 'ubisoft', 'rockstar games', 'riot games', 'tencent', 'bytedance', 'tiktok',
  'douyin', 'wechat', 'alibaba', 'aliexpress', 'taobao', 'baidu', 'jd com', 'pinduoduo', 'xiaomi',
  'huawei', 'oppo', 'vivo mobile', 'lenovo legion', 'nike', 'adidas', 'puma', 'reebok', 'under armour',
  'lululemon', 'patagonia', 'north face', 'columbia sportswear', 'uniqlo', 'zara', 'h and m', 'gap inc',
  'levis', 'gucci', 'prada', 'chanel', 'hermes', 'louis vuitton', 'dior', 'burberry', 'rolex', 'omega',
  'seiko', 'casio', 'citizen watch', 'coca cola', 'pepsi', 'nestle', 'danone', 'unilever', 'kraft',
  'mcdonalds', 'starbucks', 'subway', 'dominos', 'kfc', 'burger king', 'wendys', 'chipotle', 'dunkin',
  'red bull', 'monster energy', 'gatorade', 'heineken', 'budweiser', 'asahi', 'kirin', 'suntory',
  'sapporo', 'ajinomoto', 'kikkoman', 'meiji', 'morinaga', 'calbee', 'nissin', 'maruchan',
  // --- モビリティ・産業 ---
  'tesla', 'spacex', 'starlink', 'neuralink', 'boring company', 'rivian', 'lucid motors', 'nio',
  'byd auto', 'toyota', 'lexus', 'honda', 'acura', 'nissan', 'infiniti', 'mazda', 'subaru', 'suzuki',
  'mitsubishi', 'daihatsu', 'isuzu', 'hino', 'yamaha', 'kawasaki', 'ducati', 'harley davidson',
  'volkswagen', 'audi', 'porsche', 'lamborghini', 'bentley', 'bugatti', 'skoda', 'seat', 'bmw', 'mini',
  'mercedes benz', 'daimler', 'ford', 'lincoln motor', 'chevrolet', 'cadillac', 'buick', 'gmc',
  'jeep', 'chrysler', 'dodge', 'ram trucks', 'ferrari', 'maserati', 'alfa romeo', 'fiat', 'peugeot',
  'renault', 'citroen', 'volvo', 'jaguar', 'land rover', 'hyundai', 'kia', 'genesis motor',
  'boeing', 'airbus', 'lockheed martin', 'northrop grumman', 'raytheon', 'general electric', 'siemens',
  'bosch', 'panasonic', 'sharp corp', 'hitachi', 'fujitsu', 'nec corp', 'canon', 'nikon', 'epson',
  'ricoh', 'brother industries', 'komatsu', 'caterpillar', 'john deere', 'kubota', 'yanmar',
  // --- 金融・通信・その他 ---
  'visa inc', 'mastercard', 'american express', 'discover card', 'jcb', 'goldman sachs', 'morgan stanley',
  'jpmorgan', 'citibank', 'wells fargo', 'bank of america', 'hsbc', 'barclays', 'ubs', 'credit suisse',
  'deutsche bank', 'nomura', 'daiwa securities', 'mizuho', 'sumitomo mitsui', 'mufg', 'rakuten',
  'softbank', 'line corp', 'mercari', 'cyberagent', 'dena', 'gree', 'gmo internet', 'sakura internet',
  'ntt docomo', 'kddi', 'verizon', 'at and t', 't mobile', 'vodafone', 'orange telecom', 'telefonica',
  'comcast', 'charter communications', 'sky group', 'bbc', 'cnn', 'bloomberg', 'reuters', 'nikkei',
  'wall street journal', 'new york times', 'washington post', 'financial times', 'the guardian',
  'techcrunch', 'wired', 'the verge', 'ars technica', 'hacker news', 'stack overflow', 'reddit',
  'discord', 'telegram', 'signal messenger', 'snapchat', 'pinterest', 'tumblr', 'medium com',
  'substack', 'patreon', 'kickstarter', 'indiegogo', 'gofundme', 'etsy', 'ebay', 'walmart', 'target corp',
  'costco', 'ikea', 'home depot', 'lowes', 'best buy', 'seven eleven', 'family mart', 'lawson',
  'aeon retail', 'don quijote', 'yodobashi', 'bic camera', 'uber', 'lyft', 'grab holdings', 'didi',
  'doordash', 'instacart', 'airbnb', 'booking com', 'expedia', 'tripadvisor', 'agoda', 'jalan',
  'salesloft', 'gong io', 'outreach io', 'peloton', 'garmin', 'polar electro', 'strava', 'duolingo',
  'coursera', 'udemy', 'edx', 'khan academy', 'pluralsight', 'skillshare', 'masterclass',
];

/** 前方・後方一致に使うため、空白を除いた形も持つ。 */
export const TRADEMARK_BLOCKLIST_COMPACT: readonly string[] = TRADEMARK_BLOCKLIST.map((w) =>
  w.replace(/[^a-z0-9]/g, ''),
);
