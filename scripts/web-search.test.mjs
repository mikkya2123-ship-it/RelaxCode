/**
 * Web-search parsing and safety checks.
 *
 * The network providers are covered manually; these tests keep the pure parts
 * honest: RSS parsing, HTML extraction, URL hygiene and the SSRF host guard.
 * Run with: npm run test:websearch
 */
import { promises as dns } from 'node:dns'
import {
  cleanQuery,
  decodeEntities,
  extractHtmlTitle,
  htmlToText,
  isPrivateHostname,
  parseBingHtml,
  parseBingRss,
  parseDuckDuckGoHtml,
  safeHttpUrl,
  stripHtml,
  urlKey
} from '../src/shared/web-search.ts'
import { runWebSearch } from '../src/main/webSearch.ts'

let failed = 0
function check(label, condition, extra) {
  if (condition) {
    console.log('ok   -', label)
  } else {
    failed += 1
    console.log('FAIL -', label, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/* ------------------------------- entities -------------------------------- */

check('named entity', decodeEntities('Tom &amp; Jerry') === 'Tom & Jerry')
check('numeric entity', decodeEntities('&#1055;&#1088;&#1080;') === 'При')
check('hex entity', decodeEntities('&#x41;') === 'A')
check('no double decoding', decodeEntities('&amp;lt;') === '&lt;')
check('unknown entity stays', decodeEntities('&nope;') === '&nope;')
check('tags become spaces', stripHtml('<b>one</b> two') === 'one two')

/* ---------------------------------- RSS ---------------------------------- */

const rss = `<?xml version="1.0"?><rss><channel>
  <item>
    <title><![CDATA[OpenAI &amp; the web]]></title>
    <link>https://example.com/a?utm_source=x&amp;id=1</link>
    <description><![CDATA[<p>Fresh <b>search</b> news</p>]]></description>
    <pubDate>Tue, 20 Oct 2026 10:00:00 GMT</pubDate>
  </item>
  <item>
    <title>Second</title>
    <link>https://example.com/a?id=1&amp;utm_source=y</link>
    <description>Duplicate</description>
  </item>
  <item>
    <title>Third</title>
    <link>javascript:alert(1)</link>
    <description>Not a web page</description>
  </item>
  <item>
    <title>Fourth</title>
    <link>https://docs.example.org/guide</link>
    <description>Readable</description>
  </item>
</channel></rss>`

const parsed = parseBingRss(rss, 10)
check('rss returns safe unique results', parsed.length === 2, parsed)
check('rss title is decoded', parsed[0]?.title === 'OpenAI & the web', parsed[0])
check('rss snippet is plain text', parsed[0]?.snippet === 'Fresh search news', parsed[0])
check('rss published date is normalized', parsed[0]?.published === '2026-10-20T10:00:00.000Z')
check('rss skips unsafe schemes', parsed.every((item) => item.url.startsWith('https://')))
check('rss respects the limit', parseBingRss(rss, 1).length === 1)
const unrelatedRss = `<rss><channel><title>Bing: TON 618 quasar</title>
  <item><title>Google Translate help</title><link>https://support.google.com/translate/help</link><description>Translate text and voice</description></item>
  <item><title>TON 618 black hole</title><link>https://example.com/ton-618</link><description>A quasar with an ultramassive black hole</description></item>
</channel></rss>`
const relevantRss = parseBingRss(unrelatedRss, 10, 'TON 618 quasar')
check('rss drops results unrelated to the feed query', relevantRss.length === 1 && relevantRss[0]?.url === 'https://example.com/ton-618', relevantRss)

const ddgHtml = `<div id="links" class="results">
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=x">One <b>title</b></a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=x">First <b>snippet</b> &amp; more</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone%2F%3Futm_source%3Dx&amp;rut=x">Duplicate</a>
    </h2>
    <a class="result__snippet">Duplicate snippet</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Ftwo">Two</a>
    </h2>
    <a class="result__snippet">Second result</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=javascript%3Aalert(1)">Unsafe</a>
    </h2>
  </div>
  <div class="result result--ad results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a>
    </h2>
  </div>
</div>`
const ddg = parseDuckDuckGoHtml(ddgHtml, 10)
check('ddg returns safe unique results', ddg.length === 2, ddg)
check('ddg decodes the redirect target', ddg[0]?.url === 'https://example.com/one', ddg[0])
check('ddg keeps plain titles and snippets', ddg[0]?.title === 'One title' && ddg[0]?.snippet === 'First snippet & more', ddg[0])
check('ddg drops ads and unsafe schemes', ddg.every((item) => item.url.startsWith('https://') && !item.url.includes('duckduckgo.com')))
check('ddg respects the limit', parseDuckDuckGoHtml(ddgHtml, 1).length === 1)

const bingHtml = `<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.com/one">One <strong>title</strong></a></h2>
    <p>First <b>snippet</b> text</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS90d28">Two</a></h2>
    <p>Second snippet</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&amp;u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS90d28">Duplicate</a></h2>
    <p>Duplicate snippet</p>
  </li>
  <li class="b_algo">
    <h2><a href="javascript:alert(1)">Unsafe</a></h2>
  </li>
</ol>`
const bing = parseBingHtml(bingHtml, 10)
check('bing html returns safe unique results', bing.length === 2, bing)
check('bing html keeps a direct link', bing[0]?.url === 'https://example.com/one', bing[0])
check('bing html unwraps the redirect', bing[1]?.url === 'https://example.com/two', bing[1])
check('bing html keeps titles and snippets', bing[1]?.title === 'Two' && bing[1]?.snippet === 'Second snippet', bing[1])
check('bing html drops unsafe schemes', bing.every((item) => item.url.startsWith('https://')))
check('bing html respects the limit', parseBingHtml(bingHtml, 1).length === 1)

/* --------------------------------- HTML ---------------------------------- */

const html = `<!doctype html><html><head>
  <title>Fallback title</title>
  <meta property="og:title" content="OpenAI web search">
  <meta name="description" content="How web search works">
  <style>.x { color: red }</style>
</head><body>
  <header>Site header</header>
  <nav>Navigation</nav>
  <main>
    <h1>Web &amp; search</h1>
    <p>First <b>paragraph</b>.</p>
    <script>alert('x')</script>
    <ul><li>One</li><li>Two</li></ul>
  </main>
  <footer>Footer</footer>
</body></html>`

const text = htmlToText(html)
check('html keeps the main text', text.includes('First paragraph.'), text)
check('html decodes entities', text.includes('Web & search'), text)
check('html drops scripts', !text.includes('alert'), text)
check('html drops navigation', !text.includes('Navigation'), text)
check('html keeps list items', text.includes('• One') && text.includes('• Two'), text)
check('html title prefers og:title', extractHtmlTitle(html) === 'OpenAI web search')

/* ---------------------------------- URLs --------------------------------- */

check('http URL accepted', safeHttpUrl('https://example.com/a') === 'https://example.com/a')
check('javascript rejected', safeHttpUrl('javascript:alert(1)') === null)
check('file rejected', safeHttpUrl('file:///C:/secret') === null)
check('credentials rejected', safeHttpUrl('https://user:pass@example.com/') === null)
check('query is collapsed', cleanQuery('  openai   web\n search  ') === 'openai web search')
check('query is capped', cleanQuery('x'.repeat(500)).length === 300)
check(
  'dedupe ignores tracking and fragment',
  urlKey('https://Example.com/a/?utm_source=x#top') === urlKey('https://example.com/a')
)

/* ------------------------------- SSRF guard ------------------------------ */

for (const host of [
  'localhost',
  'app.localhost',
  'router.local',
  'metadata.google.internal',
  '127.0.0.1',
  '10.1.2.3',
  '172.16.0.1',
  '192.168.1.1',
  '169.254.169.254',
  '0.0.0.0',
  '::1',
  '::',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '0:0:0:0:0:ffff:7f00:1',
  'fd12:3456::1'
]) {
  check(`private host: ${host}`, isPrivateHostname(host) === true)
}

for (const host of [
  'example.com',
  '8.8.8.8',
  '1.1.1.1',
  '2606:4700:4700::1111',
  '::ffff:8.8.8.8',
  'sub.example.org'
]) {
  check(`public host: ${host}`, isPrivateHostname(host) === false)
}

/* ---------------------------- the whole pipeline ------------------------- */

const lookup = dns.lookup
const realFetch = globalThis.fetch
const bingRss = `<?xml version="1.0"?><rss><channel>
  <item>
    <title>Readable example test</title>
    <link>https://example.com/one</link>
    <description>First result for example test</description>
  </item>
  <item>
    <title>Broken example test</title>
    <link>https://example.com/two</link>
    <description>Second result for example test</description>
  </item>
</channel></rss>`
const emptyRss = '<?xml version="1.0"?><rss><channel></channel></rss>'
const ddgResultsHtml = `<div id="links" class="results">
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a class="result__a" href="https://example.com/one">Readable example test</a>
    </h2>
    <a class="result__snippet">First result for example fallback test</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a class="result__a" href="https://example.com/two">Broken example test</a>
    </h2>
    <a class="result__snippet">Second result for example fallback test</a>
  </div>
</div>`
const bingResultsHtml = `<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.com/one">Readable example test</a></h2>
    <p>First result for example test</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://example.com/two">Broken example test</a></h2>
    <p>Second result for example test</p>
  </li>
</ol>`
const pageHtml = `<!doctype html><html><head><title>One</title></head><body>
  <article><h1>One</h1><p>The page body has enough text to be useful for a model.</p>
  <p>It also has a second paragraph, so extraction has to keep the structure.</p></article>
</body></html>`
// A script-rendered page: no server-side text, but a description that can stand in.
const scriptOnlyHtml = `<!doctype html><html><head><title>Scripted</title>
<meta name="description" content="This description is long enough to stand in for a page that renders everything with scripts and ships no server-side text at all in its body.">
</head><body><div id="root"></div><script>window.__DATA__ = {};</script></body></html>`
const ddgScriptedHtml = `<!doctype html><html><body>
<div class="result results_links results_links_deep web-result ">
  <h2 class="result__title">
    <a class="result__a" href="https://example.com/scripted">Scripted page</a>
  </h2>
  <a class="result__snippet">Scripted result</a>
</div>
</body></html>`

dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }]
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.startsWith('https://html.duckduckgo.com/html/')) {
    const body = url.includes('bingempty')
      ? `<div class="result results_links"><a class="result__a" href="https://example.com/fallback">Fallback test result</a><a class="result__snippet">A relevant fallback test result</a></div>`
      : url.includes('empty')
        ? '<html><body>No results</body></html>'
        : ddgResultsHtml
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  if (url.startsWith('https://www.bing.com/search')) {
    if (url.includes('format=rss')) {
      const body = url.includes('bingempty') ? emptyRss : bingRss
      return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } })
    }
    const body = url.includes('bingempty') ? '<html></html>' : bingResultsHtml
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  if (url === 'https://example.com/one') {
    return new Response(pageHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  if (url === 'https://example.com/two') {
    return new Response('nope', { status: 500 })
  }
  if (url.includes('tavily.com') || url.includes('search.brave.com') || url.includes('serper.dev')) {
    return new Response('{"error":"bad key"}', { status: 401 })
  }
  throw new Error(`unexpected fetch: ${url}`)
}

try {
  const events = []
  const run = await runWebSearch(
    {
      query: 'example test',
      maxResults: 2,
      readPages: 2,
      provider: 'auto',
      apiKey: null,
      safeSearch: true,
      reserveCitations: (count) => Array.from({ length: count }, (_, index) => index + 7),
      onProgress: (meta) => events.push(meta)
    },
    new AbortController().signal
  )

  check('pipeline succeeds', run.ok === true, run)
  check('pipeline uses duckduckgo when no key is saved', run.meta.provider === 'DuckDuckGo', run.meta)
  check('pipeline numbers sources from the run budget', run.meta.sources.map((s) => s.number).join(',') === '7,8')
  check('pipeline reads the first page', run.meta.sources[0]?.status === 'read', run.meta.sources[0])
  check('pipeline reports a failed page without failing the search', run.meta.sources[1]?.status === 'failed')
  check('pipeline keeps extracted text in the model result', run.detail.includes('second paragraph'))
  check('pipeline labels web text as untrusted', /untrusted/i.test(run.detail))
  check('pipeline mentions both citations', run.detail.includes('[7]') && run.detail.includes('[8]'))
  check('pipeline says one page was opened', /opened 1 page/.test(run.summary), run.summary)
  check('pipeline streamed searching, reading and done', ['searching', 'reading', 'done'].every((stage) => events.some((event) => event.stage === stage)))
  check('pipeline streamed a reading source', events.some((event) => event.sources.some((source) => source.status === 'reading')))
  check('pipeline snapshots do not mutate old progress', events[0]?.sources.length === 0 && run.meta.sources.length === 2)

  // Auto with a key tries the keyed providers first, then falls back to DuckDuckGo.
  const fallback = await runWebSearch(
    {
      query: 'example fallback test',
      maxResults: 2,
      readPages: 0,
      provider: 'auto',
      apiKey: 'test-key',
      safeSearch: true,
      reserveCitations: (count) => Array.from({ length: count }, (_, index) => index + 1)
    },
    new AbortController().signal
  )
  check(
    'pipeline falls back to duckduckgo after keyed 401s',
    fallback.ok && fallback.meta.provider === 'DuckDuckGo',
    fallback
  )
  check(
    'pipeline does not fetch pages when readPages is zero',
    fallback.meta.sources.every((source) => source.status === 'found')
  )

  // Explicit Bing selection also falls back to DuckDuckGo if Bing has no matching results.
  const explicitBingFallback = await runWebSearch(
    {
      query: 'bingempty fallback test',
      maxResults: 2,
      readPages: 0,
      provider: 'bing',
      apiKey: null,
      safeSearch: true,
      reserveCitations: (count) => Array.from({ length: count }, (_, index) => index + 1)
    },
    new AbortController().signal
  )
  check(
    'explicit bing falls back when Bing has no relevant results',
    explicitBingFallback.ok && explicitBingFallback.meta.provider === 'DuckDuckGo',
    explicitBingFallback.meta
  )

  // An empty result set is a completed search, not a failed tool call.
  let reserved = 0
  const empty = await runWebSearch(
    {
      query: 'empty result',
      maxResults: 2,
      readPages: 1,
      provider: 'bing',
      apiKey: null,
      safeSearch: true,
      reserveCitations: (count) => {
        reserved += count
        return []
      }
    },
    new AbortController().signal
  )
  check('empty result is not a tool error', empty.ok === true, empty)
  check('empty result finishes the search', empty.meta.stage === 'done' && empty.meta.sources.length === 0)
  check('empty result explains itself', /No web results/.test(empty.summary), empty.summary)
  check('empty result reserves no citations', reserved === 0)

  // Bing's RSS feed can be empty for a query while its HTML page still has
  // organic results; the provider must fall back instead of reporting 404/empty.
  const htmlFallback = await runWebSearch(
    {
      query: 'example onlyhtml test',
      maxResults: 3,
      readPages: 0,
      provider: 'bing',
      apiKey: null,
      safeSearch: true,
      reserveCitations: (count) => Array.from({ length: count }, (_, index) => index + 1)
    },
    new AbortController().signal
  )
  check(
    'pipeline falls back to bing html when the rss feed is empty',
    htmlFallback.ok && htmlFallback.meta.provider === 'Bing' && htmlFallback.meta.sources.length === 2,
    htmlFallback
  )
  check(
    'pipeline keeps the html fallback sources numbered',
    htmlFallback.meta.sources.map((source) => source.number).join(',') === '1,2',
    htmlFallback.meta.sources
  )
} finally {
  dns.lookup = lookup
  globalThis.fetch = realFetch
}

if (failed > 0) {
  console.error(`\n${failed} web-search check(s) failed`)
  process.exit(1)
}
console.log('\nALL WEB SEARCH CHECKS PASSED')
