import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Exercise the actual routes, SQLite payloads and queues without external calls,
// a dev server, or touching the user's database. No additional test dependency.
const root = fileURLToPath(new URL('../', import.meta.url))
process.env.NEXT_PHASE = 'phase-production-build'
process.env.DATABASE_PATH = ':memory:'
for (const prefix of ['RL', 'RECON_RL']) {
  for (const [key, value] of Object.entries({BASE_INTERVAL_MS: 1, ROLLING_LIMIT_COUNT: 100000,
    ROLLING_LIMIT_WINDOW_MS: 1, ROLLING_LIMIT_SAFETY_MS: 1, PACING_START_COUNT: 100000,
    MIN_PACED_INTERVAL_MS: 1, MAX_CONCURRENT_REQUESTS: 32})) process.env[prefix+'_'+key] = String(value)
}
const originalInterval = globalThis.setInterval
globalThis.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const originalTimeout = globalThis.setTimeout
globalThis.setTimeout = (...args) => {
  const timer = originalTimeout(...args)
  // Runtime maintenance/cancellation expiry must not hold the isolated test open.
  if (args[1] > 1000) timer.unref()
  return timer
}
const calls = {day: 0, recon: 0, timetable: 0}
let stationRequests = 0
const progress = []
globalThis.fetch = async (url, options) => {
  assert.ok(String(url).endsWith('/api/search-progress'), 'unexpected non-mocked network call')
  progress.push(JSON.parse(options.body))
  return Response.json({ok: true})
}
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/flexpreis-recon.json', import.meta.url)))
const journeys = new Map()
const failedRecon = new Set(), emptyRecon = new Set(), changedRecon = new Set()
const failedTimetables = new Set(), networkFailures = new Map()
let missingDay, failedDay, reconDelay = 0
let failedDayResponse = { status: 500, body: {} }

function throwNetworkFailure(endpoint) {
  if (networkFailures.has(endpoint)) throw networkFailures.get(endpoint)
}

function journey(date, alternate = false) {
  const via = alternate ? ['Jena', 'Saalfeld'] : ['Erfurt', 'Nürnberg']
  return {ctxRecon: date+(alternate ? '-alternate' : '-main'), umstiegsAnzahl: 0,
    verbindungsDauerInSeconds: (alternate ? 420 : 240)*60,
    verbindungsAbschnitte: [{abfahrtsOrt:'Berlin Hbf',ankunftsOrt:'München Hbf',
      abfahrtsOrtExtId:'8011160',ankunftsOrtExtId:'8000261',
      abfahrt:{sollzeit:date+'T08:00:00'},ankunft:{sollzeit:date+(alternate?'T15:00:00':'T12:00:00')},
      halte:[{name:'Berlin Hbf',extId:'8011160'},...via.map(name=>({name,extId:'id-'+name})),{name:'München Hbf',extId:'8000261'}],
      verkehrsmittel:{name:alternate?'ICE 200':'ICE 100',kategorie:'ICE',produktGattung:'ICE'}}]}
}
function response(body, status=200) {
  return {status,ok:status<400,getHeader:()=>null,text:async()=>JSON.stringify(body),json:async()=>structuredClone(body)}
}
globalThis.__mockFlexFetch = async (url, options={}) => {
  if (url.includes('/orte?')) {
    stationRequests++
    const name = new URL(url).searchParams.get('suchbegriff')
    const extId = name==='Berlin Hbf'?'8011160':'8000261'
    return response([{extId,name,id:'A=1@O='+name+'@L='+extId+'@'}])
  }
  const body=JSON.parse(options.body)
  if (url.endsWith('/tagesbestpreis')) {
    calls.day++
    throwNetworkFailure('tagesbestpreis')
    const date=body.anfrageZeitpunkt.slice(0,10)
    if(date===failedDay) return response(failedDayResponse.body,failedDayResponse.status)
    const raw = (date===missingDay?[true]:[false,true]).map(alternate=>journey(date,alternate))
    for(const j of raw) journeys.set(j.ctxRecon,j)
    return response({intervalle:[{preis:{betrag:19.99},verbindungen:raw.map(verbindung=>({verbindung,abPreis:{betrag:19.99},teilpreis:false}))}]})
  }
  if (url.endsWith('/fahrplan')) {
    calls.timetable++
    throwNetworkFailure('fahrplan')
    const date=body.anfrageZeitpunkt.slice(0,10)
    if(failedTimetables.has(date)) return response({},500)
    return response({verbindungen:[journey(date,true)]})
  }
  if (url.endsWith('/recon')) {
    calls.recon++
    throwNetworkFailure('recon')
    if(reconDelay) await new Promise(r=>setTimeout(r,reconDelay))
    if(failedRecon.has(body.ctxRecon)) return response({},500)
    const j=structuredClone(journeys.get(body.ctxRecon))
    assert.ok(j,'Recon requires a discovered journey')
    if(changedRecon.has(body.ctxRecon)) j.verbindungsAbschnitte[0].verkehrsmittel.name='ICE 999'
    const fixture=fixtures.snapshots.find(f=>f.context.klasse===body.klasse&&f.context.ermaessigungArt===body.reisende[0].ermaessigungen[0].art)
    assert.ok(fixture,'fare context is forwarded to Recon')
    return response({verbindungen:[{...j,reiseAngebote:emptyRecon.has(body.ctxRecon)?[]:fixture.offers}]})
  }
  assert.fail('Unexpected Bahn endpoint '+url)
}

registerHooks({
  resolve(specifier, context, next) {
    if(specifier==='next/server') specifier='next/server.js'
    if(specifier==='next/navigation') specifier='next/navigation.js'
    if(specifier.startsWith('@/') || (specifier.startsWith('.')&&context.parentURL?.startsWith(pathToFileURL(root).href))) {
      const base=specifier.startsWith('@/')?resolve(root,specifier.slice(2)):resolve(dirname(fileURLToPath(context.parentURL)),specifier)
      const path=[base,base+'.ts',base+'.tsx',base+'.js',resolve(base,'index.ts')].find(p=>existsSync(p)&&statSync(p).isFile())
      if(path) return {url:pathToFileURL(path).href+(path.endsWith('.json') && /\.tsx?$/.test(context.parentURL || '') ? '?esm' : ''),shortCircuit:true}
    }
    return next(specifier,context)
  },
  load(url, context, next) {
    if(url.endsWith('/app/api/search-prices/bahn-http.ts')) return {format:'module',shortCircuit:true,
      source:'export const fetchBahn=(...args)=>globalThis.__mockFlexFetch(...args); export const isTemporaryBahnNetworkError=()=>false'}
    if(url.startsWith(pathToFileURL(root).href)&&!url.includes('/node_modules/')) {
      if(url.endsWith('.json?esm')) return {format:'module',shortCircuit:true,source:'export default '+readFileSync(fileURLToPath(url),'utf8')}
      if(/\.tsx?$/.test(url)) return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),
        {fileName:fileURLToPath(url),compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}
    }
    return next(url,context)
  }
})

const {NextRequest}=await import('next/server.js')
const {POST: month}=await import('../app/api/search-prices/route.ts')
const {POST: day}=await import('../app/api/flexpreis/day/route.ts')
const {fetchFlexpreisQuote,resolveFlexpreisDay,cachedFlexpreisQuote,supplementFlexpreisSources}=await import('../app/api/search-prices/flexpreis.ts')
const {metricsCollector}=await import('../app/api/metrics/collector.ts')
const {getCalendarDayLoadingPhase}=await import('../components/bestpreissuche/price-calendar.tsx')
const {scheduleSearchProgressScroll}=await import('../components/search/search-progress-panel.tsx')
const {TravelCombinations}=await import('../components/bestpreissuche/travel-combinations.tsx')
const {filterFlexpreisSources}=await import('../app/api/search-prices/bahn-api.ts')
const {buildFlexpreisSource,comparisonSource,chooseFlexpreisComparison}=await import('../lib/search/flexpreis-comparison.ts')
const {globalRateLimiter,cancelBestpreisSearchSession}=await import('../app/api/search-prices/rate-limiter.ts')
const {getEarliestSearchDateKey,getBerlinDateKey,addDaysToDateKey}=await import('../lib/shared/berlin-date.ts')
const first=addDaysToDateKey(getEarliestSearchDateKey(),7)
const defaults={start:'Berlin Hbf',ziel:'München Hbf',klasse:'KLASSE_2',alter:'ERWACHSENER',
  ermaessigungArt:'KEINE_ERMAESSIGUNG',ermaessigungKlasse:'KLASSENLOS',tarif:'FLEXPREIS',
  reisezeitraumAb:first,schnelleVerbindungen:'true',maximaleUmstiege:'alle'}
const config={...defaults,startStation:{id:'Berlin',name:'Berlin Hbf'},zielStation:{id:'München',name:'München Hbf'}}
const req=(body,path='/api/search-prices')=>new NextRequest('http://localhost:3000'+path,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})
const metricsSnapshot=()=>structuredClone(metricsCollector.getMetricsJSON())

test('optional Turnstile protects every price API before body processing, validates scope and rejects replay',async()=>{
  const {POST: holiday}=await import('../app/api/urlaubsfinder/route.ts')
  const {getTurnstileClientConfig,verifyPriceSearchRequest}=await import('../lib/security/turnstile.ts')
  const {PRICE_SEARCH_ACTIONS}=await import('../lib/security/turnstile-shared.ts')
  const keys=['TURNSTILE_ENABLED','TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','TURNSTILE_HOSTNAMES','TURNSTILE_APPEARANCE','DISABLE_PRICE_SEARCH','ENABLE_URLAUBSFINDER']
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
  const originalFetch=globalThis.fetch,before={...calls},beforeProgress=progress.length
  const used=new Set()
  let verificationCalls=0
  const handlers=[['/api/search-prices',month],['/api/urlaubsfinder',holiday],['/api/flexpreis/day',day]]
  const protectedRequest=(path,token,body='not JSON')=>new NextRequest('http://localhost:3000'+path,{
    method:'POST',body,headers:{...(token===undefined?{}:{'X-Turnstile-Token':token}),
      Host:'sparpreis.guru',Origin:'https://sparpreis.guru','CF-Connecting-IP':'127.0.0.1','X-Forwarded-For':'127.0.0.1'},
  })
  try {
    Object.assign(process.env,{TURNSTILE_ENABLED:'true',TURNSTILE_SITE_KEY:'public-test-site-key',
      TURNSTILE_SECRET_KEY:'private-test-secret',TURNSTILE_HOSTNAMES:' sparpreis.guru, WWW.SPARPREIS.GURU ',
      DISABLE_PRICE_SEARCH:'false',ENABLE_URLAUBSFINDER:'true',TURNSTILE_APPEARANCE:'interaction-only'})
    assert.deepEqual(getTurnstileClientConfig(),{enabled:true,siteKey:'public-test-site-key',appearance:'interaction-only'})
    assert.ok(!JSON.stringify(getTurnstileClientConfig()).includes('private-test-secret'))
    process.env.TURNSTILE_APPEARANCE='always'
    assert.equal(getTurnstileClientConfig().appearance,'always')
    process.env.TURNSTILE_APPEARANCE='interaction-only'
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify')
      assert.equal(options.cache,'no-store')
      assert.equal(options.redirect,'error')
      const body=JSON.parse(options.body)
      assert.equal(body.secret,'private-test-secret')
      assert.deepEqual(Object.keys(body).sort(),['response','secret'],'untrusted proxy IP headers must not be forwarded')
      verificationCalls++
      const token=body.response
      if(token==='network-error') throw new TypeError('fetch failed')
      if(token==='timeout') throw new DOMException('timeout','TimeoutError')
      if(token==='http-error') return Response.json({}, {status:502})
      if(token==='malformed-json') return new Response('<html>not JSON</html>')
      if(token==='malformed-result') return Response.json({success:'true'})
      if(token==='internal-error') return Response.json({success:false,'error-codes':['internal-error']})
      if(token==='secret-error') return Response.json({success:false,'error-codes':['invalid-input-secret']})
      if(token.startsWith('expired:')||used.has(token)) return Response.json({success:false,'error-codes':['timeout-or-duplicate']})
      used.add(token)
      return Response.json({success:true,hostname:token.startsWith('wrong-host:')?'attacker.example':token.endsWith(':alternate-host')?'WWW.SPARPREIS.GURU':'sparpreis.guru',
        action:token.startsWith('wrong-action:')?'other-action':token.startsWith('wrong-host:')?token.split(':')[1]:token.split(':')[0]})
    }
    for(const [path,handler] of handlers) {
      for(const token of [undefined,'','x'.repeat(2049)]) {
        const request=protectedRequest(path,token)
        const response=await handler(request)
        assert.equal(response.status,403)
        assert.equal((await response.json()).code,'TURNSTILE_REQUIRED')
        assert.equal(request.bodyUsed,false)
      }
    }
    assert.equal(verificationCalls,0,'missing or oversized tokens must be rejected locally')
    for(const [path,handler] of handlers) {
      for(const kind of ['wrong-host','wrong-action','expired']) {
        const token=kind+':'+PRICE_SEARCH_ACTIONS[path]
        const request=protectedRequest(path,token)
        const response=await handler(request)
        assert.equal(response.status,403)
        const payload=await response.json()
        assert.equal(payload.code,kind==='wrong-host'?'TURNSTILE_HOSTNAME_MISMATCH':kind==='wrong-action'?'TURNSTILE_ACTION_MISMATCH':'TURNSTILE_REJECTED')
        assert.equal(request.bodyUsed,false)
      }
      for(const token of ['network-error','timeout','http-error','malformed-json','malformed-result','internal-error','secret-error']) {
        const request=protectedRequest(path,token)
        const response=await handler(request)
        assert.equal(response.status,503)
        assert.equal(response.headers.get('cache-control'),'no-store')
        assert.equal((await response.json()).code,'TURNSTILE_UNAVAILABLE')
        assert.equal(request.bodyUsed,false)
      }
      const token=PRICE_SEARCH_ACTIONS[path]+':single-use'
      const allowed=protectedRequest(path,token,'{}')
      assert.equal((await handler(allowed)).status,400,'a verified request must reach ordinary parameter validation')
      assert.equal(allowed.bodyUsed,true)
      const replay=protectedRequest(path,token)
      assert.equal((await handler(replay)).status,403)
      assert.equal(replay.bodyUsed,false,'replayed tokens must not start a second search')
    }
    assert.equal(await verifyPriceSearchRequest(protectedRequest('/api/search-prices','bestpreissuche:alternate-host'),'bestpreissuche'),null,'configured alternate hostnames are accepted')
    process.env.TURNSTILE_HOSTNAMES='localhost,127.0.0.1'
    const fetchSiteverify=globalThis.fetch
    globalThis.fetch=async()=>Response.json({success:true,hostname:'localhost',action:'bestpreissuche'})
    assert.equal(await verifyPriceSearchRequest(protectedRequest('/api/search-prices','local-valid'),'bestpreissuche'),null,'explicit local development hostname is accepted')
    process.env.TURNSTILE_HOSTNAMES='sparpreis.guru'
    const wrongEnvironment=await verifyPriceSearchRequest(protectedRequest('/api/search-prices','local-denied'),'bestpreissuche')
    assert.equal(wrongEnvironment.status,403,'a localhost token must still fail against a production-only hostname list')
    assert.equal((await wrongEnvironment.json()).code,'TURNSTILE_HOSTNAME_MISMATCH')
    globalThis.fetch=fetchSiteverify
    process.env.TURNSTILE_HOSTNAMES='sparpreis.guru,www.sparpreis.guru'
    const beforeConfigFailure=verificationCalls
    for(const key of ['TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','TURNSTILE_HOSTNAMES']) {
      const saved=process.env[key]
      delete process.env[key]
      for(const [path,handler] of handlers) {
        const request=protectedRequest(path,'not-verified')
        assert.equal((await handler(request)).status,503)
        assert.equal(request.bodyUsed,false)
      }
      process.env[key]=saved
    }
    assert.equal(verificationCalls,beforeConfigFailure,'configuration failures must not call Siteverify')
    process.env.DISABLE_PRICE_SEARCH='true'
    for(const [path,handler] of handlers) {
      assert.equal((await handler(protectedRequest(path))).status,503,'deployment suspension takes precedence')
    }
    assert.equal(verificationCalls,beforeConfigFailure)
    process.env.DISABLE_PRICE_SEARCH='false'
    for(const disabledValue of [undefined,'false','0']) {
      if(disabledValue===undefined) delete process.env.TURNSTILE_ENABLED
      else process.env.TURNSTILE_ENABLED=disabledValue
      assert.deepEqual(getTurnstileClientConfig(),{enabled:false,siteKey:'',appearance:'interaction-only'})
      assert.equal(await verifyPriceSearchRequest(protectedRequest('/api/search-prices'),'bestpreissuche'),null)
    }
    assert.deepEqual(calls,before,'no rejected request may contact Bahn')
    assert.equal(progress.length,beforeProgress,'no rejected request may register search work')
  } finally {
    globalThis.fetch=originalFetch
    for(const key of keys) {
      if(previous[key]===undefined) delete process.env[key]
      else process.env[key]=previous[key]
    }
  }
})

test('price-search client obtains a fresh scoped token per new search, preserves errors and aborts before fetching',async()=>{
  const {createPriceSearchFetch}=await import('../lib/security/price-search-fetch.ts')
  const {PriceSearchVerificationError,PRICE_SEARCH_ACTIONS}=await import('../lib/security/turnstile-shared.ts')
  const originalFetch=globalThis.fetch
  const sent=[],challenges=[]
  try {
    globalThis.fetch=async(path,options)=>{
      sent.push({path,headers:new Headers(options.headers)})
      return Response.json({ok:true})
    }
    const verifiedFetch=createPriceSearchFetch(async(action)=>{
      challenges.push(action)
      return 'fresh-'+challenges.length
    })
    for(const path of Object.keys(PRICE_SEARCH_ACTIONS)) {
      await verifiedFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      await verifiedFetch(path,{method:'POST',body:'{}'})
    }
    assert.deepEqual(challenges,['bestpreissuche','bestpreissuche','urlaubsfinder','urlaubsfinder','flexpreis','flexpreis'])
    assert.equal(new Set(sent.map(request=>request.headers.get('x-turnstile-token'))).size,6)
    assert.equal(sent[0].headers.get('content-type'),'application/json')
    await createPriceSearchFetch(null)('/api/search-prices',{method:'POST',body:'{}'})
    assert.equal(sent.at(-1).headers.has('x-turnstile-token'),false)
    const before=sent.length,beforeChallenges=challenges.length
    const controller=new AbortController()
    controller.abort()
    await assert.rejects(verifiedFetch('/api/search-prices',{method:'POST',signal:controller.signal}),{name:'AbortError'})
    assert.equal(challenges.length,beforeChallenges)
    await assert.rejects(createPriceSearchFetch(async()=>{throw new PriceSearchVerificationError('Prüfung fehlgeschlagen')})('/api/search-prices',{}),PriceSearchVerificationError)
    assert.equal(sent.length,before,'failed verification must not issue a price request')
    const abortDuringChallenge=new AbortController()
    await assert.rejects(createPriceSearchFetch(async()=>{abortDuringChallenge.abort();return 'unused-token'})('/api/search-prices',{
      method:'POST',signal:abortDuringChallenge.signal,
    }),{name:'AbortError'})
    assert.equal(sent.length,before,'cancellation during verification must not issue a price request')
    globalThis.fetch=async()=>Response.json({code:'TURNSTILE_UNAVAILABLE',error:'Sicherheitsprüfung nicht verfügbar'}, {status:503})
    await assert.rejects(verifiedFetch('/api/search-prices',{method:'POST'}),error=>error instanceof PriceSearchVerificationError && error.message==='Sicherheitsprüfung nicht verfügbar')
    globalThis.fetch=async()=>Response.json({error:'OPS_BLOCKED'}, {status:403})
    assert.equal((await verifiedFetch('/api/search-prices',{method:'POST'})).status,403,'upstream HTTP failures retain their ordinary handling')
  } finally {globalThis.fetch=originalFetch}
})

test('search grants allow bounded calendar and Flexpreis follow-ups without another Siteverify call',async()=>{
  const {consumeSearchGrant}=await import('../lib/security/search-grants.ts')
  const keys=['TURNSTILE_ENABLED','TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','TURNSTILE_HOSTNAMES','DISABLE_PRICE_SEARCH']
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
  const originalFetch=globalThis.fetch,originalNow=Date.now
  let siteverifyCalls=0
  const grantFirst=addDaysToDateKey(first,120)
  const initialBody={...defaults,reisezeitraumAb:grantFirst,reisezeitraumBis:grantFirst,sessionId:crypto.randomUUID()}
  const request=(body,grant,token)=>new NextRequest('http://localhost:3000/api/search-prices',{
    method:'POST',body:typeof body==='string'?body:JSON.stringify(body),headers:{'Content-Type':'application/json',
      ...(grant?{'X-Price-Search-Grant':grant}:{}),...(token?{'X-Turnstile-Token':token}:{})},
  })
  try {
    Object.assign(process.env,{TURNSTILE_ENABLED:'true',TURNSTILE_SITE_KEY:'public-test-key',TURNSTILE_SECRET_KEY:'private-test-secret',
      TURNSTILE_HOSTNAMES:'sparpreis.guru',DISABLE_PRICE_SEARCH:'false'})
    globalThis.fetch=async(url,options)=>{
      if(String(url)==='https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        siteverifyCalls++
        return Response.json({success:true,hostname:'sparpreis.guru',action:'bestpreissuche'})
      }
      return originalFetch(url,options)
    }
    const initial=await month(request(initialBody,undefined,'fresh-cloudflare-token'))
    assert.equal(initial.status,200)
    const grant=initial.headers.get('x-price-search-grant')
    assert.match(grant,/^[a-f0-9]{64}$/)
    assert.equal(initial.headers.has('set-cookie'),false,'a fresh price search never creates a cookie')
    await initial.text()
    assert.equal(siteverifyCalls,1)
    const extraDate=addDaysToDateKey(grantFirst,1)
    const extraBody={...initialBody,reisezeitraumAb:extraDate,reisezeitraumBis:extraDate,
      requestedOutwardDates:[extraDate],requestedReturnDates:[],sessionId:crypto.randomUUID()}
    const extra=await month(request(extraBody,grant))
    assert.equal(extra.status,200)
    assert.equal(extra.headers.get('x-price-search-grant'),null,'follow-ups do not renew or widen the grant')
    await extra.text()
    const daily=await day(request({...initialBody,date:extraDate,sessionId:crypto.randomUUID()},grant))
    assert.equal(daily.status,200)
    await daily.json()
    assert.equal(siteverifyCalls,1,'calendar and Flexpreis follow-ups must not ask Cloudflare again')
    const before={...calls}
    const emptyTokenBypass=request({...extraBody,ziel:'Hamburg Hbf'},grant)
    emptyTokenBypass.headers.set('X-Turnstile-Token','')
    const emptyTokenResult=await month(emptyTokenBypass)
    assert.equal(emptyTokenResult.status,403)
    assert.equal((await emptyTokenResult.json()).code,'TURNSTILE_REQUIRED','an empty token header must not bypass grant scope, budget or issuance checks')
    assert.equal(emptyTokenBypass.bodyUsed,false)
    for(const changes of [{ziel:'Hamburg Hbf'},{klasse:'KLASSE_1'},{ermaessigungArt:'BAHNCARD50'},{abfahrtAb:'09:00'},{tarif:'SPARPREIS'}]) {
      const denied=await month(request({...extraBody,...changes},grant))
      assert.equal(denied.status,403)
      assert.equal((await denied.json()).code,'SEARCH_GRANT_SCOPE')
    }
    const outside=addDaysToDateKey(grantFirst,15)
    const outsideResult=await month(request({...extraBody,reisezeitraumAb:outside,reisezeitraumBis:outside,requestedOutwardDates:[outside]},grant))
    assert.equal((await outsideResult.json()).code,'SEARCH_GRANT_DATES','a fixed extension window must not slide after a successful follow-up')
    const hugeWindow=await month(request({...extraBody,reisezeitraumBis:'9999-12-31'},grant))
    assert.equal((await hugeWindow.json()).code,'SEARCH_GRANT_DATES','altered windows are rejected before enumerating their dates')
    const fullSearch=await month(request(initialBody,grant))
    assert.equal((await fullSearch.json()).code,'SEARCH_GRANT_SCOPE','a grant is not a reusable new-search credential')
    for(const candidateGrant of [undefined,'f'.repeat(64)]) {
      const deniedRequest=request('invalid JSON',candidateGrant)
      assert.equal((await month(deniedRequest)).status,403)
      assert.equal(deniedRequest.bodyUsed,false,'unknown grants fail before processing the body')
    }
    for(let index=0;index<27;index++) {
      assert.equal(consumeSearchGrant(request(extraBody,grant),extraBody,{outward:[extraDate],returns:[]}),null)
    }
    const exhausted=await month(request(extraBody,grant))
    assert.equal((await exhausted.json()).code,'SEARCH_GRANT_EXHAUSTED')
    assert.deepEqual(calls,before,'scope failures and exhausted budgets must not contact Bahn')
    Date.now=()=>originalNow()+20*60_000+1
    const expired=request('invalid JSON',grant)
    assert.equal((await month(expired)).status,403)
    assert.equal(expired.bodyUsed,false)
    assert.equal(siteverifyCalls,1)
  } finally {
    Date.now=originalNow
    globalThis.fetch=originalFetch
    for(const key of keys) {
      if(previous[key]===undefined) delete process.env[key]
      else process.env[key]=previous[key]
    }
  }
})

test('client reuses only a follow-up grant and obtains one fresh Turnstile token after expiry or exhaustion',async()=>{
  const {createPriceSearchFetch}=await import('../lib/security/price-search-fetch.ts')
  const originalFetch=globalThis.fetch
  let challenges=0,requests=0
  const seen=[]
  try {
    globalThis.fetch=async(path,options)=>{
      const headers=new Headers(options.headers)
      seen.push({path,grant:headers.get('x-price-search-grant'),token:headers.get('x-turnstile-token')})
      requests++
      assert.equal(options.credentials,'same-origin')
      if(requests===3) return Response.json({code:'SEARCH_GRANT_EXHAUSTED'}, {status:403})
      return Response.json({ok:true},{headers:headers.has('x-turnstile-token')?{'X-Price-Search-Grant':'grant-'+challenges}:{}})
    }
    const secured=createPriceSearchFetch(async()=> 'turnstile-'+(++challenges))
    await secured('/api/search-prices',{method:'POST'})
    await secured('/api/search-prices',{method:'POST'},true)
    assert.equal(challenges,1)
    assert.deepEqual(seen[1],{path:'/api/search-prices',grant:'grant-1',token:null})
    await secured('/api/flexpreis/day',{method:'POST'},true)
    assert.equal(challenges,2)
    assert.deepEqual(seen[3],{path:'/api/flexpreis/day',grant:null,token:'turnstile-2'})
    await secured('/api/search-prices',{method:'POST'})
    assert.equal(challenges,3,'a new top-level search always requires a new Cloudflare token')
    await secured('/api/urlaubsfinder',{method:'POST'},true)
    assert.equal(challenges,4,'calendar grants never unlock unrelated Urlaubsfinder requests')
    const afterReload=createPriceSearchFetch(async()=> 'turnstile-'+(++challenges))
    await afterReload('/api/search-prices',{method:'POST'},true)
    assert.equal(challenges,5,'a new page instance cannot recover a grant after F5')
    assert.equal(seen.at(-1).grant,null)
  } finally {globalThis.fetch=originalFetch}
})

test('station-search permissions validate Turnstile separately and enforce exactly 100 autocomplete requests, including parallel cache hits',async()=>{
  const {GET:stations,POST:click}=await import('../app/api/station-search/route.ts')
  const {POST:authorize}=await import('../app/api/station-search/verify/route.ts')
  const {consumeStationSearchGrant}=await import('../lib/security/station-search-grants.ts')
  const keys=['TURNSTILE_ENABLED','TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY','TURNSTILE_HOSTNAMES']
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),savedFetch=globalThis.fetch
  const request=(grant='',q='Protected station fixture')=>new NextRequest('https://sparpreis.guru/api/station-search?q='+encodeURIComponent(q),{headers:grant?{'X-Station-Search-Grant':grant}:{}})
  const verify=token=>authorize(new NextRequest('https://sparpreis.guru/api/station-search/verify',{
    method:'POST',headers:token?{'X-Turnstile-Token':token}:{}}))
  let validations=0
  const used=new Set()
  try {
    Object.assign(process.env,{TURNSTILE_ENABLED:'true',TURNSTILE_SITE_KEY:'public-test-key',TURNSTILE_SECRET_KEY:'private-test-key',TURNSTILE_HOSTNAMES:'sparpreis.guru'})
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify')
      validations++
      const {response:token}=JSON.parse(options.body)
      if(used.has(token)) return Response.json({success:false,'error-codes':['timeout-or-duplicate']})
      used.add(token)
      if(token==='unavailable') return new Response('',{status:503})
      return Response.json({success:true,hostname:token==='wrong-host'?'attacker.example':'sparpreis.guru',
        action:token==='wrong-action'?'bestpreissuche':'station-search'})
    }
    const before=stationRequests
    assert.equal((await stations(request())).status,403)
    assert.equal((await stations(request('a'.repeat(64)))).status,403)
    const priceOnly=request();priceOnly.headers.set('X-Price-Search-Grant','a'.repeat(64))
    assert.equal((await stations(priceOnly)).status,403)
    assert.equal((await verify()).status,403)
    assert.equal((await verify('wrong-host')).status,403)
    assert.equal((await verify('wrong-action')).status,403)
    assert.equal((await verify('unavailable')).status,503)
    assert.equal(stationRequests,before,'rejection happens before station lookup or upstream work')
    let bodyRead=false
    const tracking=new NextRequest('https://sparpreis.guru/api/station-search',{method:'POST',body:'{}'})
    tracking.json=async()=>{bodyRead=true;throw Error('must not parse')}
    assert.equal((await click(tracking)).status,403)
    assert.equal(bodyRead,false)

    const authorized=await verify('station-permission')
    assert.equal(authorized.status,200)
    const grant=authorized.headers.get('x-station-search-grant')
    assert.match(grant,/^[a-f0-9]{64}$/)
    assert.equal(authorized.headers.has('set-cookie'),false)
    assert.equal((await verify('station-permission')).status,403,'the Cloudflare token is single use')
    const validated=validations
    const first=await stations(request(grant))
    assert.equal(first.status,200)
    assert.equal((await first.json()).cached,false)
    assert.equal(first.headers.get('cache-control'),'no-store')
    const parallel=await Promise.all(Array.from({length:99},()=>stations(request(grant))))
    assert.ok(parallel.every(response=>response.status===200))
    assert.equal(stationRequests,before+1,'all further requests hit the existing station cache')
    assert.equal(validations,validated,'subsequent station requests never reuse a Cloudflare token')
    const exhausted=await stations(request(grant))
    assert.equal(exhausted.status,403)
    assert.equal((await exhausted.json()).code,'STATION_GRANT_EXHAUSTED')
    assert.equal(stationRequests,before+1)

    const priceRequest=req({...defaults,reisezeitraumBis:defaults.reisezeitraumAb},'/api/search-prices')
    priceRequest.headers.set('X-Station-Search-Grant',grant)
    assert.equal((await month(priceRequest)).status,403,'the station header cannot authorize a price search')
    priceRequest.headers.set('X-Price-Search-Grant',grant)
    assert.equal((await month(priceRequest)).status,403,'a station grant is also invalid in the price-grant header')
    assert.equal(consumeStationSearchGrant(request(grant),true),null,'selection tracking has its own bounded budget')
    for(let i=0;i<99;i++) assert.equal(consumeStationSearchGrant(request(grant),true),null)
    assert.equal(consumeStationSearchGrant(request(grant),true).status,403)

    const now=Date.now(),savedNow=Date.now
    const renewed=await verify('station-expiry'),renewedGrant=renewed.headers.get('x-station-search-grant')
    try {
      Date.now=()=>now+15*60_000
      assert.equal(consumeStationSearchGrant(request(renewedGrant)),null)
      Date.now=()=>now+30*60_000+100
      const expired=consumeStationSearchGrant(request(renewedGrant))
      assert.equal((await expired.json()).code,'STATION_GRANT_EXPIRED','use must not extend the fixed expiry')
    } finally {Date.now=savedNow}
    process.env.TURNSTILE_SECRET_KEY=''
    assert.equal((await stations(request(grant))).status,503,'incomplete configuration fails closed even with a grant')
    process.env.TURNSTILE_ENABLED='false'
    assert.equal((await stations(request())).status,200,'disabled Turnstile preserves ordinary station lookup')
    const disabled=await verify()
    assert.equal(disabled.status,200)
    assert.equal(disabled.headers.has('set-cookie'),false)
  } finally {
    globalThis.fetch=savedFetch
    for(const key of keys) if(previous[key]===undefined) delete process.env[key];else process.env[key]=previous[key]
  }
})

test('station client shares one verification across fields, skips cancelled inputs, and renews after permission expiry',async()=>{
  const {createStationSearchClient}=await import('../lib/security/station-search-fetch.ts')
  const savedFetch=globalThis.fetch
  let challenges=0,release,started,clicks=0
  const allowed=new Set()
  const began=new Promise(resolve=>{started=resolve}),seen=[]
  try {
    globalThis.fetch=async(path,options)=>{
      seen.push(path)
      assert.equal(options.credentials,'same-origin')
      if(path==='/api/station-search/verify') {
        assert.equal(new Headers(options.headers).get('x-turnstile-token'),'station-token-'+challenges)
        const id=String(challenges).padStart(64,'0')
        allowed.add(id)
        return Response.json({ok:true},{headers:{'X-Station-Search-Grant':id}})
      }
      assert.equal(new Headers(options.headers).has('x-turnstile-token'),false)
      const permitted=allowed.has(new Headers(options.headers).get('x-station-search-grant'))
      if(path==='/api/station-search') {
        assert.equal(permitted,true)
        assert.equal(options.keepalive,true)
        clicks++
        return Response.json({ok:true})
      }
      return permitted?Response.json({results:[{name:path}]}):Response.json({code:'STATION_GRANT_REQUIRED'},{status:403})
    }
    const getToken=async()=>{
      challenges++
      started()
      if(challenges===1) await new Promise(resolve=>{release=resolve})
      return 'station-token-'+challenges
    }
    const client=createStationSearchClient(getToken)
    await client.recordSelection('Berlin',{name:'Berlin Hbf',extId:'8011160'})
    assert.equal(challenges,0,'selection tracking must never start a challenge')
    const controller=new AbortController()
    const obsolete=client.search('obsolete',{signal:controller.signal})
    const current=client.search('current')
    await began
    await new Promise(resolve=>setImmediate(resolve))
    controller.abort()
    const aborted=assert.rejects(obsolete,{name:'AbortError'})
    release()
    await aborted
    assert.equal((await current).status,200)
    assert.equal(challenges,1)
    assert.equal(seen.filter(path=>path.includes('q=obsolete')).length,1,'cancelled input is not fetched after verification')
    assert.equal((await client.search('another')).status,200)
    assert.equal(challenges,1)
    await client.recordSelection('Berlin',{name:'Berlin Hbf',extId:'8011160'})
    assert.equal(clicks,1,'selection POST carries the in-memory permission header')
    allowed.clear()
    const renewed=await Promise.all([client.search('start'),client.search('destination')])
    assert.ok(renewed.every(response=>response.status===200))
    assert.equal(challenges,2,'an expired shared permission causes one new verification')
    const afterReload=createStationSearchClient(getToken)
    assert.equal((await afterReload.search('after F5')).status,200)
    assert.equal(challenges,3,'a reloaded page has no saved permission, even while old server grants exist')
    assert.equal((await client.search('still open')).status,200)
    assert.equal(challenges,3,'other live page instances retain their own permissions')
    afterReload.dispose()
    client.dispose()
    await assert.rejects(client.search('disposed'),{name:'AbortError'})
  } finally {globalThis.fetch=savedFetch}
})

test('station client surfaces verification errors without retry loops and makes no challenge when disabled',async()=>{
  const {createStationSearchClient}=await import('../lib/security/station-search-fetch.ts')
  const savedFetch=globalThis.fetch
  let challenges=0,stationCalls=0,verifyCalls=0
  try {
    globalThis.fetch=async(path)=>{
      if(path==='/api/station-search/verify') {verifyCalls++;return Response.json({error:'Prüfung nicht verfügbar'},{status:503})}
      stationCalls++;return Response.json({code:'STATION_GRANT_EXPIRED'},{status:403})
    }
    const client=createStationSearchClient(async()=>{challenges++;return 'token'})
    await assert.rejects(client.search('Berlin'),/Prüfung nicht verfügbar/)
    assert.deepEqual([challenges,stationCalls,verifyCalls],[1,1,1])
    await assert.rejects(client.search('Hamburg'),/Prüfung nicht verfügbar/)
    assert.deepEqual([challenges,stationCalls,verifyCalls],[2,2,2],'the next explicit request may try verification again')
    globalThis.fetch=async(path)=>{assert.match(path,/q=Berlin/);return Response.json({results:[]})}
    assert.equal((await createStationSearchClient(null).search('Berlin')).status,200)
    assert.equal(challenges,2)
  } finally {globalThis.fetch=savedFetch}
})

test('Turnstile stays absent when disabled and enabled pages disclose the service without exposing secrets',async()=>{
  const {PriceSearchProvider}=await import('../components/search/price-search-provider.tsx')
  const {Footer}=await import('../components/layout/footer.tsx')
  const content=createElement(Footer,{show:true})
  const disabled=renderToStaticMarkup(createElement(PriceSearchProvider,{config:{enabled:false,siteKey:''}},content))
  assert.doesNotMatch(disabled,/Cloudflare|challenges\.cloudflare\.com|<script/)
  const enabled=renderToStaticMarkup(createElement(PriceSearchProvider,{config:{enabled:true,siteKey:'public-key'}},content))
  assert.match(enabled,/Cloudflare Turnstile/)
  assert.match(enabled,/https:\/\/www\.cloudflare\.com\/turnstile-privacy-policy\//)
  assert.match(enabled,/IP-Adresse/)
  for(const html of [disabled,enabled]) assert.match(html,/Die Anwendung verarbeitet Suchanfragen/,'the general privacy notice remains visible in both modes')
  assert.doesNotMatch(enabled,/challenges\.cloudflare\.com|<script/,'the widget script is loaded only on an actual search attempt')
})


test('one-way calendar includes the route and price summary before the first API metadata or prices arrive',async()=>{
  const {PriceCalendar}=await import('../components/bestpreissuche/price-calendar.tsx')
  const props={results:{},isStreaming:true,onDayClick(){},expectedDays:7,
    startStation:{name:'Berlin Hbf',id:'8011160'},zielStation:{name:'Hamburg Hbf',id:'8002549'},
    searchParams:{reisezeitraumAb:first,reisezeitraumBis:addDaysToDateKey(first,6),tarif:'SPARPREIS'}}
  const pending=renderToStaticMarkup(createElement(PriceCalendar,props))
  const header=markup=>markup.match(/<header\b[\s\S]*?<\/header>/)?.[0]
  assert.ok(header(pending))
  for(const text of ['Einfache Fahrt','Berlin Hbf','Hamburg Hbf','Günstigster Bestpreis']) assert.ok(header(pending).includes(text))
  assert.match(header(pending),/7 Reisetage geplant/)
  assert.doesNotMatch(header(pending),/7 Reisetage ausgewertet/,'no result claim during verification')
  assert.match(header(pending),/Günstigster Preis wird ermittelt/)
  const priced=renderToStaticMarkup(createElement(PriceCalendar,{...props,isStreaming:false,results:{[first]:{
    preis:29.99,info:'',abfahrtsZeitpunkt:first+'T08:00:00',ankunftsZeitpunkt:first+'T10:00:00'}}}))
  for(const text of ['Einfache Fahrt','Berlin Hbf','Hamburg Hbf','Günstigster Bestpreis']) assert.ok(header(priced).includes(text))
  assert.match(header(priced),/29,99/)
})

test('direct search links require an in-memory submission and preserve prefilled values without mounting results',async()=>{
  const {canonicalSearchQuery,matchesSubmittedSearch}=await import('../lib/search/search-submission.ts')
  const {SearchSubmissionProvider}=await import('../components/search/search-submission-provider.tsx')
  const {PriceSearchProvider,PriceSearchVerificationStatus}=await import('../components/search/price-search-provider.tsx')
  const {TrainResults}=await import('../components/bestpreissuche/train-results.tsx')
  const {ClassicFinder}=await import('../components/bestpreissuche/classic-finder.tsx')
  const {AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime.js')
  const params={start:'Berlin Hbf',ziel:'München Hbf',reisezeitraumAb:first,reisezeitraumBis:addDaysToDateKey(first,6),klasse:'KLASSE_2'}
  const query=new URLSearchParams(params).toString()
  assert.equal(matchesSubmittedSearch(null,params),false,'the URL alone never authorizes an automatic search')
  assert.equal(matchesSubmittedSearch(canonicalSearchQuery(query),params),true)
  assert.equal(matchesSubmittedSearch(canonicalSearchQuery(query),{...params,ziel:'Hamburg Hbf'}),false)
  assert.equal(canonicalSearchQuery('ziel=M%C3%BCnchen+Hbf&start=Berlin%20Hbf'),canonicalSearchQuery({start:'Berlin Hbf',ziel:'München Hbf'}))
  const secured=children=>createElement(PriceSearchProvider,{config:{enabled:true,siteKey:'public-key'}},
    createElement(SearchSubmissionProvider,null,children))
  assert.equal(renderToStaticMarkup(secured(createElement(TrainResults,{searchParams:params}))), '')
  assert.equal(renderToStaticMarkup(secured(createElement(PriceSearchVerificationStatus))), '')
  const classic=renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:{push(){assert.fail('render must not navigate')}}},
    secured(createElement(ClassicFinder,{searchParams:params}))))
  assert.match(classic,/value="Berlin Hbf"/)
  assert.match(classic,/value="München Hbf"/)
  assert.match(classic,new RegExp('value="'+first+'"'))
  assert.doesNotMatch(classic,/id="calendar"|id="classicStatus"|Sicherheitsprüfung läuft|<dialog|<script/)
})

test('Turnstile loader waits for the API callback, shares concurrent loads and never calls ready after script loading',async()=>{
  const {createTurnstileLoader}=await import('../lib/security/turnstile-loader.ts')
  const previousWindow=globalThis.window,previousDocument=globalThis.document,previousFetch=globalThis.fetch
  const scripts=[],browser={},sent=[]
  try {
    globalThis.window=browser
    globalThis.document={createElement(tag){assert.equal(tag,'script');return {remove(){this.removed=true}}},
      head:{appendChild(script){
        const url=new URL(script.src)
        assert.equal(url.origin,'https://challenges.cloudflare.com')
        assert.equal(url.searchParams.get('render'),'explicit')
        assert.equal(typeof browser[url.searchParams.get('onload')],'function','callback must exist before loading even a cached script')
        scripts.push(script)
      }}}
    globalThis.fetch=async(path,options)=>{sent.push(new Headers(options.headers).get('x-turnstile-token'));return Response.json({ok:true})}
    const load=createTurnstileLoader(),waiting=load()
    assert.equal(load(),waiting)
    assert.equal(scripts.length,1)
    const api={render(container,options){options.callback('fresh-api-token');return 'widget-id'},remove(){},
      ready(){assert.fail('the script must not depend on turnstile.ready()')}}
    browser.turnstile=api
    const {createPriceSearchFetch}=await import('../lib/security/price-search-fetch.ts')
    const secured=createPriceSearchFetch(async()=>{
      const loaded=await load()
      return new Promise(resolve=>loaded.render({}, {callback:resolve}))
    })
    const search=secured('/api/search-prices',{method:'POST'})
    await Promise.resolve()
    assert.deepEqual(sent,[],'no price request while the API has not signalled readiness')
    browser[new URL(scripts[0].src).searchParams.get('onload')]()
    assert.equal(await waiting,api)
    assert.equal((await search).status,200)
    assert.deepEqual(sent,['fresh-api-token'])
    assert.equal(await load(),api)
    assert.equal(scripts.length,1,'later searches reuse the loaded API')
  } finally {globalThis.window=previousWindow;globalThis.document=previousDocument;globalThis.fetch=previousFetch}
})

test('Turnstile script insertion errors are cleaned up and the next load can complete synchronously',async()=>{
  const {createTurnstileLoader}=await import('../lib/security/turnstile-loader.ts')
  const savedWindow=globalThis.window,savedDocument=globalThis.document
  const browser={},scripts=[]
  let blocked=true
  try {
    globalThis.window=browser
    const api={render(){return 'widget'},remove(){}}
    globalThis.document={createElement(){return {remove(){this.removed=true}}},head:{appendChild(script){
      scripts.push(script)
      if(blocked) throw new Error('script insertion blocked')
      browser.turnstile=api
      browser[new URL(script.src).searchParams.get('onload')]()
    }}}
    const load=createTurnstileLoader()
    await assert.rejects(load(),/konnte nicht geladen/)
    assert.equal(scripts[0].removed,true)
    assert.equal(browser.sparpreisTurnstileLoaded,undefined)
    blocked=false
    assert.equal(await load(),api)
    assert.equal(scripts.length,2,'an insertion error must not poison the cached load promise')
  } finally {globalThis.window=savedWindow;globalThis.document=savedDocument}
})

test('Turnstile script network failures and callback timeouts reject promptly and permit a fresh load',async(t)=>{
  const {createTurnstileLoader}=await import('../lib/security/turnstile-loader.ts')
  const previousWindow=globalThis.window,previousDocument=globalThis.document
  const scripts=[],browser={}
  t.mock.timers.enable({apis:['setTimeout']})
  try {
    globalThis.window=browser
    globalThis.document={createElement(){return {remove(){this.removed=true}}},head:{appendChild(script){scripts.push(script)}}}
    const load=createTurnstileLoader()
    const networkFailure=load()
    scripts[0].onerror()
    await assert.rejects(networkFailure,/konnte nicht geladen/)
    assert.equal(scripts[0].removed,true)
    const timeout=load()
    const staleCallback=browser[new URL(scripts[1].src).searchParams.get('onload')]
    t.mock.timers.tick(15_000)
    await assert.rejects(timeout,/konnte nicht geladen/)
    assert.equal(scripts[1].removed,true)
    const retry=load()
    assert.equal(scripts.length,3)
    const api={render(){return 'widget-id'},remove(){}}
    browser.turnstile=api
    staleCallback()
    const currentCallback=browser[new URL(scripts[2].src).searchParams.get('onload')]
    assert.equal(typeof currentCallback,'function','a timed-out attempt cannot settle the retry')
    currentCallback()
    assert.equal(await retry,api)
    t.mock.timers.tick(15_000)
    assert.equal(scripts[2].removed,undefined,'success clears its load timeout')
  } finally {t.mock.timers.reset();globalThis.window=previousWindow;globalThis.document=previousDocument}
})

test('Turnstile dialog promotion satisfies native modal preconditions without replacing its container',async()=>{
  const {setVerificationDialogMode}=await import('../components/search/price-search-provider.tsx')
  const calls=[]
  const dialog={open:true,isConnected:true,
    close(){this.open=false;calls.push('close')},
    show(){assert.equal(this.open,false);this.open=true;calls.push('inline')},
    showModal(){assert.equal(this.open,false);this.open=true;calls.push('modal')}}
  assert.deepEqual(calls,[],'automatic verification stays inline')
  setVerificationDialogMode(dialog,true)
  assert.deepEqual(calls,['close','modal'])
  setVerificationDialogMode(dialog,false)
  assert.deepEqual(calls,['close','modal','close','inline'])
  dialog.isConnected=false
  setVerificationDialogMode(dialog,true)
  assert.equal(calls.length,4,'late widget callbacks cannot open a detached dialog')
})

test('deployment price-search switch blocks every price API before reading the body and can be lifted without reimporting',async()=>{
  const {POST: holiday}=await import('../app/api/urlaubsfinder/route.ts')
  const {isPriceSearchDisabled}=await import('../lib/shared/feature-flags.ts')
  const {getPriceSearchUnavailableResponse}=await import('../lib/search/price-search-availability.ts')
  const previousDisabled=process.env.DISABLE_PRICE_SEARCH
  const previousHoliday=process.env.ENABLE_URLAUBSFINDER
  const before={...calls},beforeProgress=progress.length
  try {
    process.env.ENABLE_URLAUBSFINDER='true'
    for(const value of [undefined,'false','0','no','']) {
      if(value===undefined) delete process.env.DISABLE_PRICE_SEARCH
      else process.env.DISABLE_PRICE_SEARCH=value
      assert.equal(isPriceSearchDisabled(),false)
      assert.equal(getPriceSearchUnavailableResponse(),null)
    }
    for(const value of ['true','1','yes',' TRUE ']) {
      process.env.DISABLE_PRICE_SEARCH=value
      assert.equal(isPriceSearchDisabled(),true)
      for(const [handler,path] of [[month,'/api/search-prices'],[day,'/api/flexpreis/day'],[holiday,'/api/urlaubsfinder']]) {
        const request=new NextRequest('http://localhost:3000'+path,{method:'POST',body:'invalid JSON'})
        const result=await handler(request)
        assert.equal(result.status,503)
        assert.equal(result.headers.get('cache-control'),'no-store')
        const payload=await result.json()
        assert.equal(payload.code,'PRICE_SEARCH_DISABLED')
        assert.match(payload.error,/Akamai/)
        assert.equal(payload.repositoryUrl,'https://github.com/sparpreis-guru/sparpreis.guru')
        assert.equal(request.bodyUsed,false,'disabled requests must not start processing')
      }
    }
    process.env.ENABLE_URLAUBSFINDER='false'
    assert.equal((await holiday(req({},'/api/urlaubsfinder'))).status,404,'the existing hide switch takes precedence')
    process.env.DISABLE_PRICE_SEARCH='false'
    assert.equal((await day(req({},'/api/flexpreis/day'))).status,400,'lifting the switch restores regular validation')
    assert.deepEqual(calls,before,'disabled requests must not contact Bahn')
    assert.equal(progress.length,beforeProgress,'disabled requests must not register search work')
  } finally {
    if(previousDisabled===undefined) delete process.env.DISABLE_PRICE_SEARCH
    else process.env.DISABLE_PRICE_SEARCH=previousDisabled
    if(previousHoliday===undefined) delete process.env.ENABLE_URLAUBSFINDER
    else process.env.ENABLE_URLAUBSFINDER=previousHoliday
  }
})

test('disabled search overlay explains the block and keeps the underlying page inert',async()=>{
  const {PriceSearchUnavailablePage}=await import('../components/search/price-search-unavailable-page.tsx')
  for(const label of ['Bestpreissuche','Klassik','Urlaubsfinder']) {
    const background=createElement('form',null,createElement('button',null,label))
    const html=renderToStaticMarkup(createElement(PriceSearchUnavailablePage,null,background))
    assert.match(html,/Preisabfragen machen gerade Pause/)
    assert.match(html,/Akamai/)
    assert.match(html,/href="https:\/\/github.com\/sparpreis-guru\/sparpreis\.guru"/)
    assert.match(html,/selbst hosten/)
    assert.match(html,/href="\/direktverbindungen"/)
    assert.match(html,/<div inert="" aria-hidden="true"[^>]*><form>/)
    assert.match(html,/role="dialog"/)
    assert.match(html,/aria-modal="true"/)
    assert.match(html,/backdrop-blur-sm/)
    assert.match(html,new RegExp(label))
  }
})

function labeledMetric(snapshot,group,name,labels) {
  return snapshot[group][name]?.find(series=>Object.keys(series.labels).length===Object.keys(labels).length &&
    Object.entries(labels).every(([key,value])=>series.labels[key]===value))?.value
}
const counter=(snapshot,name,labels)=>labels ? labeledMetric(snapshot,'labeledCounters',name,labels) || 0 : snapshot.counters[name] || 0
async function search(count,extra={}) {
  const res=await month(req({...defaults,reisezeitraumBis:addDaysToDateKey(first,count-1),sessionId:crypto.randomUUID(),...extra}))
  assert.equal(res.status,200)
  const raw=await res.text(),events=raw.trim().split('\n').map(JSON.parse)
  assert.ok(!events.some(e=>e.type==='error'))
  const complete=events.findLast(e=>e.type==='complete')
  assert.ok(complete,'search must complete after price work')
  assert.ok(!raw.includes('ctxRecon'),'opaque handles must stay server-side')
  return {events,results:complete.results,meta:complete.results._meta}
}

test('7/14/30 days, warm cache and mode/basis changes share discovery and quote only what is missing',async()=>{
  let mainBasis, alternateBasis
  for(const count of [7,14,30]) {
    const before={...calls},beforeMetrics=metricsSnapshot(),run=await search(count)
    mainBasis ||= run.meta.flexComparison.basis.id
    alternateBasis ||= run.meta.flexComparison.bases.find(b=>b.id!==mainBasis).id
    assert.equal(run.meta.flexComparison.basis.id,mainBasis)
    assert.equal(Object.keys(run.results).filter(k=>k!=='_meta').length,count)
    for(const [date,value] of Object.entries(run.results)) if(date!=='_meta') {
      assert.equal(value.flexpreis.status,'priced');assert.equal(value.flexpreis.basisId,mainBasis)
      assert.equal(value.flexpreis.comparisonQuote.amountCents,17220)
    }
    const newlyMissing=count===7?7:count===14?7:16
    assert.equal(calls.day-before.day,newlyMissing);assert.equal(calls.recon-before.recon,newlyMissing)
    const afterMetrics=metricsSnapshot()
    assert.equal(counter(afterMetrics,'bahn_api_requests_total')-counter(beforeMetrics,'bahn_api_requests_total'),2*newlyMissing)
    for(const endpoint of ['tagesbestpreis','recon']) {
      const labels={endpoint,status:'200'}
      assert.equal(counter(afterMetrics,'bahn_api_requests_by_endpoint_total',labels)-counter(beforeMetrics,'bahn_api_requests_by_endpoint_total',labels),newlyMissing)
      const hist=snapshot=>labeledMetric(snapshot,'labeledHistograms','bahn_api_response_time_by_endpoint_ms',{endpoint})?.count || 0
      assert.equal(hist(afterMetrics)-hist(beforeMetrics),newlyMissing)
    }
    assert.equal(counter(afterMetrics,'flexpreis_cache_misses_total',{kind:'offer'})-counter(beforeMetrics,'flexpreis_cache_misses_total',{kind:'offer'}),newlyMissing)
    assert.equal(counter(afterMetrics,'flexpreis_cache_hits_total',{kind:'offer'})-counter(beforeMetrics,'flexpreis_cache_hits_total',{kind:'offer'}),count-newlyMissing)
  }
  const before={...calls}
  await search(30);await search(30,{tarif:'SPARPREIS'});await search(30,{tarif:'SPARPREIS'})
  assert.deepEqual(calls,before,'warm repetition and Flex→Bestpreis→Bestpreis must not call Bahn')
  const changed=await search(7,{flexBasisId:alternateBasis})
  assert.equal(changed.meta.flexComparison.basis.id,alternateBasis)
  assert.equal(calls.day,before.day);assert.equal(calls.recon,before.recon+7)
  const pendingProgress=progress.filter(p=>!p.isComplete&&p.remainingReconRequests>0)
  assert.ok(pendingProgress.length>0,'ETA must include Recon work')
})

test('rendered extra day keeps a single bounded loader until its Flexpreis arrives',async()=>{
  const {createElement}=await import('react')
  const {renderToStaticMarkup}=await import('react-dom/server')
  const {PriceCalendar}=await import('../components/bestpreissuche/price-calendar.tsx')
  const {FlexpreisDayComparison}=await import('../components/bestpreissuche/flexpreis-day-comparison.tsx')
  const date=getBerlinDateKey()
  const source=buildFlexpreisSource(journey(date))
  const pending={version:1,basisId:source.route.key,status:'pending',quotes:[],alternativesStatus:'idle'}
  const ordinary={preis:19.99,info:'',abfahrtsZeitpunkt:date+'T08:00:00',ankunftsZeitpunkt:date+'T12:00:00'}
  const originalDate=addDaysToDateKey(date,-1)
  const props={tarif:'FLEXPREIS',onDayClick:()=>{},
    searchParams:{...defaults,reisezeitraumAb:originalDate,reisezeitraumBis:originalDate},
    flexComparison:chooseFlexpreisComparison({[date]:[source]}),
    isStreaming:false,lazyDayRequest:{date,status:'loading'},
    results:{[date]:{...ordinary,flexpreis:pending}}}
  const html=renderToStaticMarkup(createElement(PriceCalendar,props))
  const cell=html.match(/<button\b[^>]*aria-label="[^"]*Flexpreis wird abgefragt"[\s\S]*?<\/button>/)?.[0]
  assert.ok(cell,'received Bestpreis must not hide the pending Flexpreis')
  assert.match(cell,/aria-busy="true"/)
  assert.equal((cell.match(/animate-spin/g)||[]).length,1)
  assert.match(cell,/min-h-0 flex-1 flex-col/)
  assert.match(cell,/justify-center gap-1 overflow-hidden/)
  assert.ok(!cell.includes('19,99'),'no ordinary price in the Flexpreis cell')

  const skeleton=renderToStaticMarkup(createElement(FlexpreisDayComparison,{data:pending,isPending:true}))
  assert.match(skeleton,/Flexpreis wird geprüft/)
  assert.match(skeleton,/animate-pulse motion-reduce:animate-none/)
  const cancelled=renderToStaticMarkup(createElement(FlexpreisDayComparison,{data:pending,isPending:false}))
  assert.match(cancelled,/nicht abschließend geprüft/)
  assert.ok(!cancelled.includes('animate-spin'))

  const quote={connectionKey:source.connectionKey,amountCents:17220,currency:'EUR',name:'Flexpreis',
    productClass:source.route.productClass,conditions:[],route:source.route,legs:source.legs,
    recordedAt:Date.now(),bookingUrl:'https://www.bahn.de/buchung/fahrplan/suche',bookingKind:'search'}
  const priced={...pending,status:'priced',comparisonQuote:quote,quotes:[quote]}
  const complete=renderToStaticMarkup(createElement(PriceCalendar,{...props,results:{[date]:{...ordinary,flexpreis:priced}}}))
  assert.ok(!complete.includes('Flexpreis wird abgefragt'))
  assert.match(complete,/172,20/)
  assert.match(complete,/md:hidden">172€<\/span>/,'small calendar cells use rounded euro amounts')
  assert.match(complete,/md:block">172,20 €<\/span>/,'wide calendar cells keep both decimal places')
  assert.match(complete,/title="172,20 €"/)
  assert.match(complete,/aria-label="[^"]*Flexpreis 172,20 €"/)
  const footer=markup=>markup.match(/<div class="border-t bg-blue-50[^\"]*">([\s\S]*?)<\/div>/)?.[1]
  const pendingFooter=footer(html),completeFooter=footer(complete)
  assert.ok(pendingFooter)
  assert.equal(pendingFooter,completeFooter,'calendar footer keeps its content and geometry when the final pending price arrives')
  assert.ok(!completeFooter.includes('Details zur Vergleichsverbindung und ihrem Preis'),'no redundant footer instruction')
  const warning=markup=>markup.match(/<span[^>]*>Für einzelne Tage fehlt[\s\S]*?<\/span>/)?.[0]
  assert.match(warning(pendingFooter),/aria-hidden="true"/,'pending prices are not missing comparison results')
  const missing=renderToStaticMarkup(createElement(PriceCalendar,{...props,lazyDayRequest:undefined,
    results:{[date]:{...ordinary,flexpreis:{...pending,status:'missing_connection'}}}}))
  const missingFooter=footer(missing)
  assert.ok(missingFooter)
  assert.ok(!warning(missingFooter).includes('aria-hidden="true"'),'a confirmed missing comparison result shows the warning')
  const visibleState=markup=>markup.replaceAll(' invisible','').replaceAll(' aria-hidden="true"','')
  assert.equal(visibleState(missingFooter),visibleState(completeFooter),'the warning replaces the hint within the same reserved text area')
  const ordinaryCalendar=renderToStaticMarkup(createElement(PriceCalendar,{...props,tarif:'SPARPREIS'}))
  assert.match(ordinaryCalendar,/md:hidden">20€<\/span>/,'ordinary prices use the same compact calendar format')
  assert.match(ordinaryCalendar,/title="19,99 €"/)
  const row=renderToStaticMarkup(createElement(FlexpreisDayComparison,{data:priced}))
  assert.match(row,/Fahrtverlauf anzeigen/)
  assert.match(row,/Angebotsdetails anzeigen/)
  assert.match(row,/aria-controls=/)
  assert.match(row,/aria-label="Fahrt buchen"/)
  assert.match(row,/>Buchen<\/span>/)

  const routeComparison=chooseFlexpreisComparison({[date]:[source]})
  const known={comparison:routeComparison,origin:source.route.origin.name,destination:source.route.destination.name}
  const loadingRow=renderToStaticMarkup(createElement(FlexpreisDayComparison,{...known,data:pending,isPending:true}))
  const pricedRow=renderToStaticMarkup(createElement(FlexpreisDayComparison,{...known,data:priced}))
  for(const value of [source.route.origin.name,source.route.destination.name,'Flexpreis','ICE','Vergleichsverbindung']) {
    assert.ok(loadingRow.includes(value),`known ${value} remains visible while pricing`)
  }
  assert.ok(loadingRow.includes(routeComparison.basis.label.replace('ICE · ','')))
  assert.equal((loadingRow.match(/disabled=""/g)||[]).length,3,'journey, offer and booking actions reserve their space but are disabled')
  assert.ok(!loadingRow.includes('172,20'),'pending price is not an old quote')
  assert.ok(!loadingRow.includes('08:00'),'unknown exact times are not copied from another journey')
  const loadingArticle=loadingRow.match(/<article\b[\s\S]*?<\/article>/)?.[0]
  assert.ok(loadingArticle)
  assert.ok(!loadingArticle.includes('ca. 4 h'),'typical duration stays in the selector instead of becoming an exact journey duration')
  const journeySection=html=>html.match(/<section class="([^"]*)" aria-label="Einfache Fahrt"/)?.[1]
  assert.ok(journeySection(loadingRow))
  assert.equal(journeySection(loadingRow),journeySection(pricedRow),'pending and priced rows share the summary grid')
  assert.equal((loadingRow.match(/<article/g)||[]).length,1)
  assert.equal((loadingRow.match(/<header/g)||[]).length,(pricedRow.match(/<header/g)||[]).length,'loading adds no extra status row')
  const checkMore={...known,data:priced,onCheckMore:()=>{}}
  const streamingWithQuote=renderToStaticMarkup(createElement(FlexpreisDayComparison,{...checkMore,isBasisLoading:true}))
  const finishedWithQuote=renderToStaticMarkup(createElement(FlexpreisDayComparison,{...checkMore,isBasisLoading:false}))
  const checkButton=markup=>markup.match(/<button[^>]*>Weitere Flexpreise prüfen<\/button>/)?.[0]
  assert.ok(checkButton(streamingWithQuote),'the extra-price action is present while other days are still loading')
  assert.match(checkButton(streamingWithQuote),/disabled=""/)
  assert.ok(!checkButton(finishedWithQuote).includes('disabled=""'),'completion enables the existing action')
})

test('day details color all Flexpreis offers using the calendar period instead of ordinary or daily prices',async()=>{
  const {DayDetailsPanel}=await import('../components/bestpreissuche/day-details-panel.tsx')
  const source=buildFlexpreisSource(journey(first))
  const comparison=chooseFlexpreisComparison({[first]:[source]})
  const quote={connectionKey:source.connectionKey,amountCents:12440,currency:'EUR',name:'Flexpreis',
    productClass:source.route.productClass,conditions:[],route:source.route,legs:source.legs,
    recordedAt:Date.now(),bookingKind:'search'}
  const cheaper={...quote,connectionKey:'cheaper',amountCents:11490}
  const expensive={...quote,connectionKey:'expensive',amountCents:20000}
  const props={date:first,searchParams:defaults,flexComparison:comparison,
    flexpreisPrices:[114.9,124.4,200],data:{preis:19.99,info:'',
      abfahrtsZeitpunkt:source.route.representativeDeparture,ankunftsZeitpunkt:source.route.representativeArrival,
      flexpreis:{version:1,basisId:comparison.basis.id,status:'priced',comparisonQuote:quote,
        quotes:[quote,cheaper,expensive],alternativesStatus:'complete'}}}
  const assertPriceColor=(markup,price,color)=>{
    const boxes=[...markup.matchAll(new RegExp(`<div class="([^"]*)" aria-label="Preis ${price}">`,'g'))]
    assert.equal(boxes.length,2,'both the mobile and desktop price box receive the color')
    for(const [,classes] of boxes) assert.ok(classes.includes(color),`${price}: expected ${color}, got ${classes}`)
  }
  const markup=renderToStaticMarkup(createElement(DayDetailsPanel,props))
  assertPriceColor(markup,'114,90 €','bg-green-100')
  assertPriceColor(markup,'124,40 €','bg-emerald-50')
  assertPriceColor(markup,'200,00 €','bg-red-50')
  // A cheaper price on another queried day changes this day's color immediately.
  const updated=renderToStaticMarkup(createElement(DayDetailsPanel,{...props,flexpreisPrices:[100,114.9,124.4,200]}))
  assertPriceColor(updated,'114,90 €','bg-emerald-50')
})

test('calendar and result selectors share a route with unique labels and no change action for a single route',async()=>{
  const {createElement,Fragment}=await import('react')
  const {renderToStaticMarkup}=await import('react-dom/server')
  const {FlexpreisBasisSelector}=await import('../components/bestpreissuche/flexpreis-basis-selector.tsx')
  const {FlexpreisDayComparison}=await import('../components/bestpreissuche/flexpreis-day-comparison.tsx')
  const {DirectJourneyBadge}=await import('../components/search/journey-result.tsx')
  const comparison=chooseFlexpreisComparison({[first]:[buildFlexpreisSource(journey(first)),buildFlexpreisSource(journey(first,true))]})
  const props={comparison,isLoading:false,onChange:()=>{}}
  const html=renderToStaticMarkup(createElement(Fragment,null,
    createElement(FlexpreisBasisSelector,props),createElement(FlexpreisBasisSelector,{...props,showExplanation:false})))
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1])
  assert.equal(new Set(ids).size,ids.length,'two mounted selectors must not duplicate ids')
  assert.equal((html.match(/role="combobox"/g)||[]).length,2)
  for(const control of html.match(/<button\b[^>]*role="combobox"[^>]*>/g)||[]) {
    assert.match(control,/bg-white/)
    assert.match(control,/border-gray-300/)
    assert.match(control,/text-gray-900/)
    assert.match(control,/min-h-11/)
    assert.match(control,/hover:border-blue-400/)
    assert.match(control,/focus:ring-blue-500/)
    assert.ok(!control.includes('border-transparent'),'the route control must be distinct from its blue header')
  }
  assert.equal((html.match(/aria-label="Gefundene Verbindungen dieses Reisewegs"/g)||[]).length,2,'both entry points show the same search facts')
  assert.match(html,/<dt[^>]*>Gefundene Fahrten<\/dt>/)
  assert.equal((html.match(/lucide-clock/g)||[]).length,2)
  assert.equal((html.match(/lucide-calendar-days/g)||[]).length,2)
  const directBadge=renderToStaticMarkup(createElement(DirectJourneyBadge))
  assert.equal(html.split(directBadge).length-1,2,'both entry points reuse the exact shared direct-journey badge')
  assert.ok(!html.includes('bg-secondary'),'facts use the journey-badge treatment')
  assert.match(html,/bg-slate-100 text-slate-800/)
  assert.match(html,/bg-white text-gray-700/)
  assert.match(html,/<dt[^>]*>Umstiege<\/dt>/)
  assert.match(html,/>Direkt</)
  assert.match(html,/Treffer dieser Suche/)
  assert.match(html,/Andere VIA-Strecken/)
  assert.match(html,/Produktklassen \(ICE, IC\/EC\)/)
  assert.ok(!html.includes('z. B. IC statt ICE'))
  assert.ok(!html.includes('Günstigere Flexpreise können deshalb fehlen'))
  assert.ok(!html.includes('Weitere, günstigere Flexpreise können fehlen'))
  assert.match(html,/<dt[^>]*>Vorauswahl<\/dt>/)
  assert.match(html,/<dt[^>]*>Ticketgültigkeit<\/dt>/)
  assert.match(html,/<dt[^>]*>Preisvergleich<\/dt>/)
  assert.match(html,/Ändern/)
  assert.match(html,/an den meisten Reisetagen/)
  assert.match(html,/VIA-Angabe des Tickets/)
  assert.ok(!html.includes('max-w-prose'),'explanations use the available width')
  const results=renderToStaticMarkup(createElement(FlexpreisDayComparison,{comparison,onBasisChange:()=>{},isBasisLoading:true}))
  assert.match(results,/Reiseweg im Tagesvergleich/)
  assert.match(results,/Ändern/)
  assert.match(results,/<button\b[^>]*disabled=""[^>]*role="combobox"|<button\b[^>]*role="combobox"[^>]*disabled=""/)
  assert.ok(!results.includes('nicht aus Schätzungen'))
  const single=renderToStaticMarkup(createElement(FlexpreisBasisSelector,{...props,showExplanation:false,comparison:{...comparison,bases:[comparison.basis]}}))
  assert.ok(!single.includes('Ändern'))
  assert.ok(!single.includes('role="combobox"'))
  const missing=renderToStaticMarkup(createElement(FlexpreisBasisSelector,{...props,showExplanation:false,comparison:{...comparison,basis:undefined}}))
  assert.match(missing,/role="combobox"/)
  assert.match(missing,/Reiseweg auswählen/)
  const withTransfer=renderToStaticMarkup(createElement(FlexpreisBasisSelector,{...props,showExplanation:false,comparison:{...comparison,basis:{...comparison.basis,typicalTransfers:1}}}))
  assert.match(withTransfer,/lucide-shuffle/)
  assert.match(withTransfer,/1 Umstieg/)
  assert.ok(!withTransfer.includes('Hinweise zum Reiseweg'),'the explanation is not repeated below the calendar')
})

test('a missing comparison path is not replaced with an unrelated price',async()=>{
  missingDay=addDaysToDateKey(first,2)
  const initial=await search(1)
  const one=await search(1,{reisezeitraumAb:missingDay,reisezeitraumBis:missingDay,flexBasisId:initial.meta.flexComparison.basis.id,
    alter:'SENIOR'}) // separate discovery key
  assert.equal(one.results[missingDay].flexpreis.status,'missing_connection')
  assert.equal(one.results[missingDay].flexpreis.comparisonQuote,undefined)
  assert.ok(calls.timetable>0)
  missingDay=undefined
})

test('day lookup retains a valid primary when an additional Recon fails; retry succeeds',async()=>{
  const date=addDaysToDateKey(first,10)
  const basis=buildFlexpreisSource(journey(date)).route.key
  failedRecon.add(date+'-alternate')
  const result=await day(req({...defaults,date,flexBasisId:basis,sessionId:crypto.randomUUID()},'/api/flexpreis/day'))
  assert.equal(result.status,200)
  const payload=(await result.json()).flexpreis
  assert.equal(payload.status,'priced');assert.equal(payload.quotes.length,1);assert.equal(payload.alternativesStatus,'partial')
  failedRecon.delete(date+'-alternate')
  const retry=await day(req({...defaults,date,flexBasisId:basis,sessionId:crypto.randomUUID()},'/api/flexpreis/day'))
  assert.equal((await retry.json()).flexpreis.quotes.length,2)
})

test('no offer caches briefly; technical or changed-journey errors never poison the quote cache',async()=>{
  const date=addDaysToDateKey(first,40),j=journey(date),s=buildFlexpreisSource(j)
  journeys.set(j.ctxRecon,j)
  emptyRecon.add(j.ctxRecon)
  const before=calls.recon
  const beforeMetrics=metricsSnapshot()
  assert.equal((await fetchFlexpreisQuote(s,config)).status,'no_offer')
  assert.equal((await fetchFlexpreisQuote(s,config)).status,'no_offer');assert.equal(calls.recon,before+1)
  const afterMetrics=metricsSnapshot()
  for(const name of ['flexpreis_cache_hits_total','flexpreis_cache_misses_total']) {
    assert.equal(counter(afterMetrics,name,{kind:'offer'})-counter(beforeMetrics,name,{kind:'offer'}),1)
  }
  for(let probe=0;probe<3;probe++) assert.equal(cachedFlexpreisQuote(s,config).status,'no_offer')
  assert.deepEqual(metricsSnapshot().labeledCounters,afterMetrics.labeledCounters,'ETA probes must not count as cache lookups')
  emptyRecon.delete(j.ctxRecon)
  const other={...config,ermaessigungArt:'BAHNCARD25'}
  changedRecon.add(j.ctxRecon)
  assert.equal((await fetchFlexpreisQuote(s,other)).status,'error')
  changedRecon.delete(j.ctxRecon)
  assert.equal((await fetchFlexpreisQuote(s,other)).quote.amountCents,12915)
})

test('inflight deduplication is scoped to a session and cancellation does not cancel another user',async()=>{
  const date=addDaysToDateKey(first,41),j=journey(date),s=buildFlexpreisSource(j)
  journeys.set(j.ctxRecon,j);reconDelay=30
  const before=calls.recon,beforeMetrics=metricsSnapshot(),sessionId=crypto.randomUUID()
  const [a,b]=await Promise.all([fetchFlexpreisQuote(s,{...config,sessionId}),fetchFlexpreisQuote(s,{...config,sessionId})])
  assert.equal(a.quote.amountCents,b.quote.amountCents);assert.equal(calls.recon,before+1)
  assert.equal(counter(metricsSnapshot(),'flexpreis_cache_misses_total',{kind:'offer'})-counter(beforeMetrics,'flexpreis_cache_misses_total',{kind:'offer'}),1)
  const cancelled=crypto.randomUUID(),active=crypto.randomUUID()
  globalRateLimiter.registerSearchSession(cancelled,1,1);cancelBestpreisSearchSession(cancelled,'user_request')
  const requestsBeforeCancellation=counter(metricsSnapshot(),'bahn_api_requests_total')
  const [bad,good]=await Promise.all([resolveFlexpreisDay([s],{...config,sessionId:cancelled},s.route.key),
    resolveFlexpreisDay([s],{...config,sessionId:active},s.route.key)])
  assert.equal(bad.comparisonQuote,undefined);assert.equal(good.status,'priced');reconDelay=0
  assert.equal(counter(metricsSnapshot(),'bahn_api_requests_total'),requestsBeforeCancellation,'cancelled queue work and cached results do not call Bahn')
})

test('HTTP failures count exactly once per executed endpoint and retain the real status',async()=>{
  const date=addDaysToDateKey(first,70),j=journey(date),s=buildFlexpreisSource(j),before=metricsSnapshot()
  failedDay=date;failedRecon.add(j.ctxRecon);failedTimetables.add(date)
  try {
    const run=await search(1,{reisezeitraumAb:date,reisezeitraumBis:date})
    assert.equal(run.results[date].flexpreis.status,'error')
    assert.equal((await fetchFlexpreisQuote(s,config)).status,'error')
    await assert.rejects(supplementFlexpreisSources(date,config))
    const after=metricsSnapshot()
    assert.equal(counter(after,'bahn_api_requests_total')-counter(before,'bahn_api_requests_total'),3)
    assert.equal(counter(after,'bahn_api_requests_by_status_total',{status:'500'})-counter(before,'bahn_api_requests_by_status_total',{status:'500'}),3)
    for(const endpoint of ['tagesbestpreis','recon','fahrplan']) {
      const labels={endpoint,status:'500'}
      assert.equal(counter(after,'bahn_api_requests_by_endpoint_total',labels)-counter(before,'bahn_api_requests_by_endpoint_total',labels),1)
      assert.equal(counter(after,'bahn_api_network_errors_total',{endpoint})-counter(before,'bahn_api_network_errors_total',{endpoint}),0)
    }
  } finally { failedDay=undefined;failedRecon.delete(j.ctxRecon);failedTimetables.delete(date) }
})

test('network failures and timeouts count without inventing HTTP 500 responses',async()=>{
  const date=addDaysToDateKey(first,71),s=buildFlexpreisSource(journey(date)),before=metricsSnapshot()
  networkFailures.set('tagesbestpreis',new TypeError('Connection reset'))
  networkFailures.set('recon',new DOMException('Request timed out','AbortError'))
  networkFailures.set('fahrplan',new Error('Connection refused'))
  try {
    const run=await search(1,{reisezeitraumAb:date,reisezeitraumBis:date})
    assert.equal(run.results[date].flexpreis.status,'error')
    assert.equal((await fetchFlexpreisQuote(s,config)).status,'error')
    await assert.rejects(supplementFlexpreisSources(date,config))
    const after=metricsSnapshot()
    assert.equal(counter(after,'bahn_api_requests_total')-counter(before,'bahn_api_requests_total'),3)
    assert.equal(counter(after,'bahn_api_requests_by_status_total',{status:'500'}),counter(before,'bahn_api_requests_by_status_total',{status:'500'}))
    for(const endpoint of ['tagesbestpreis','recon','fahrplan']) {
      const labels={endpoint,status:'network_error'}
      assert.equal(counter(after,'bahn_api_requests_by_endpoint_total',labels)-counter(before,'bahn_api_requests_by_endpoint_total',labels),1)
      assert.equal(counter(after,'bahn_api_network_errors_total',{endpoint})-counter(before,'bahn_api_network_errors_total',{endpoint}),1)
    }
    const exported=metricsCollector.exportPrometheusMetrics()
    assert.match(exported,/bahn_api_requests_by_endpoint_total\{endpoint="recon",status="network_error"\}/)
    assert.match(exported,/bahn_api_response_time_by_endpoint_ms_count\{endpoint="recon"\}/)
  } finally { networkFailures.clear() }
})

test('supplementary timetable cache counts real reuse and avoids duplicate requests',async()=>{
  const date=addDaysToDateKey(first,72),before=metricsSnapshot(),beforeCalls=calls.timetable
  const sources=await supplementFlexpreisSources(date,config)
  const cached=await supplementFlexpreisSources(date,config)
  assert.deepEqual(cached.map(s=>s.connectionKey),sources.map(s=>s.connectionKey))
  assert.equal(calls.timetable,beforeCalls+1)
  const after=metricsSnapshot()
  for(const name of ['flexpreis_cache_hits_total','flexpreis_cache_misses_total']) {
    assert.equal(counter(after,name,{kind:'timetable'})-counter(before,name,{kind:'timetable'}),1)
  }
})

test('rate-limit responses remain in both overall and endpoint metrics',async()=>{
  const before=metricsSnapshot(),limited={status:429}
  assert.equal(await metricsCollector.measureBahnApiRequest('recon',async()=>limited),limited)
  const after=metricsSnapshot()
  assert.equal(counter(after,'bahn_api_requests_total')-counter(before,'bahn_api_requests_total'),1)
  assert.equal(counter(after,'bahn_api_rate_limits_total')-counter(before,'bahn_api_rate_limits_total'),1)
  assert.equal(counter(after,'bahn_api_rate_limits_by_endpoint_total',{endpoint:'recon'})-counter(before,'bahn_api_rate_limits_by_endpoint_total',{endpoint:'recon'}),1)
  assert.equal(counter(after,'bahn_api_requests_by_endpoint_total',{endpoint:'recon',status:'429'})-counter(before,'bahn_api_requests_by_endpoint_total',{endpoint:'recon',status:'429'}),1)
})

test('sources respect the requested departure date and the daily endpoint rejects malformed parameters',async()=>{
  const tomorrow=buildFlexpreisSource(journey(addDaysToDateKey(first,1)))
  assert.equal(filterFlexpreisSources([tomorrow],{anfrageDatum:new Date(first+'T12:00:00Z')}).length,0)
  for(const change of [{date:'2026-02-31'},{klasse:'KLASSE_3'},{abfahrtAb:'29:00'},{umstiegszeit:'NaN'},{maximaleUmstiege:99}]) {
    assert.equal((await day(req({...defaults,date:first,...change},'/api/flexpreis/day'))).status,400)
  }
})

test('connection discovery failures remain errors in the calendar and daily endpoint',async()=>{
  failedDay=addDaysToDateKey(first,60)
  const before={...calls}
  try {
    const run=await search(1,{reisezeitraumAb:failedDay,reisezeitraumBis:failedDay})
    assert.equal(run.results[failedDay].flexpreis.status,'error')
    const basis=buildFlexpreisSource(journey(first)).route.key
    const selected=await search(1,{reisezeitraumAb:failedDay,reisezeitraumBis:failedDay,flexBasisId:basis})
    assert.equal(selected.results[failedDay].flexpreis.status,'error')
    const res=await day(req({...defaults,date:failedDay,flexBasisId:basis},'/api/flexpreis/day'))
    assert.equal(res.status,503)
    assert.equal(calls.timetable,before.timetable,'a failed discovery must not trigger timetable lookups')
    assert.equal(calls.recon,before.recon)
  } finally { failedDay=undefined }
})

test('negative Recon checks identify outdated prices even before a subsequent failure',async()=>{
  const date=addDaysToDateKey(first,61),primary=journey(date),alternate=journey(date,true)
  for(const j of [primary,alternate]) journeys.set(j.ctxRecon,j)
  emptyRecon.add(primary.ctxRecon);failedRecon.add(alternate.ctxRecon)
  try {
    const sources=[primary,alternate].map(buildFlexpreisSource)
    const result=await resolveFlexpreisDay(sources,config,sources[0].route.key,true)
    assert.equal(result.status,'no_offer');assert.equal(result.alternativesStatus,'partial')
    assert.deepEqual(result.checkedConnectionKeys,[sources[0].connectionKey])
  } finally { emptyRecon.delete(primary.ctxRecon);failedRecon.delete(alternate.ctxRecon) }
})

test('blocked price responses survive streaming and render as actionable errors, including partial results',async()=>{
  const {getSearchFailures,getDaySearchFailure,describeSearchFailure}=await import('../lib/search/search-errors.ts')
  const {SearchErrorNotice}=await import('../components/search/search-error-notice.tsx')
  const {PriceCalendar}=await import('../components/bestpreissuche/price-calendar.tsx')
  const date=addDaysToDateKey(first,95)
  failedDay=date
  failedDayResponse={status:403,body:{status:'ERROR',code:'OPS_BLOCKED',errorRefId:'private-ref'}}
  try {
    const run=await search(2,{tarif:'SPARPREIS',reisezeitraumAb:date,reisezeitraumBis:addDaysToDateKey(date,1)})
    const failures=getSearchFailures(Object.entries(run.results).filter(([key])=>key!=='_meta').map(([,value])=>value))
    assert.equal(failures.length,1)
    assert.equal(failures[0].kind,'blocked')
    assert.ok(run.results[addDaysToDateKey(date,1)].preis>0,'successful days must survive')
    const failureEvent=run.events.find(event=>event.type==='dayResult'&&event.date===date)
    assert.equal(getDaySearchFailure(failureEvent.result).kind,'blocked')
    for(const hasResults of [false,true]) {
      const html=renderToStaticMarkup(createElement(SearchErrorNotice,{failures,hasResults}))
      assert.match(html,/role="alert"/)
      assert.match(html,/HTTP 403, OPS_BLOCKED/)
      assert.doesNotMatch(html,/<button\b/)
      assert.doesNotMatch(html,/Keine Preise gefunden|private-ref/)
      assert.equal(html.includes('Ergebnisse sind unvollständig'),hasResults)
    }
    // PriceCalendar initially shows the current month; use today's date to check its failure cell.
    const today=getBerlinDateKey()
    const currentCalendar=renderToStaticMarkup(createElement(PriceCalendar,{
      results:{[today]:failureEvent.result},onDayClick:()=>{},searchParams:{...defaults,tarif:'SPARPREIS',reisezeitraumAb:today,reisezeitraumBis:today},tarif:'SPARPREIS',
    }))
    assert.match(currentCalendar,/aria-label="[^"]*HTTP 403, OPS_BLOCKED/)
    assert.match(currentCalendar,/Preisabfrage fehlgeschlagen/)
    assert.doesNotMatch(currentCalendar,/Keine Verbindung verfügbar/)
  } finally { failedDay=undefined;failedDayResponse={status:500,body:{}} }
  for(const info of ['Kein Bestpreis verfügbar!','Keine Verbindungen im gewählten Zeitfenster','Keine Intervalle gefunden!','Search cancelled']) {
    assert.equal(getDaySearchFailure({preis:0,info}),null,info)
  }
  for(const [info,kind] of [['API Error: HTTP 429','rate_limit'],['Rate limited, retrying','rate_limit'],
    ['API Error: Request timed out','timeout'],['API Error: fetch failed','network'],['JSON Parse Error','response'],['API Error: HTTP 503: <html>internal</html>','request']]) {
    const error=getDaySearchFailure({preis:0,info})
    assert.equal(error.kind,kind)
    assert.doesNotMatch(error.message,/<html>|internal/)
  }
  assert.equal(getSearchFailures([{preis:0,info:'API Error: HTTP 403'},{preis:0,info:'API Error: HTTP 403'}]).length,1)
  assert.equal(describeSearchFailure('Failed to fetch').kind,'network')
})

test('round-trip API failures suppress the no-combinations claim while normal empty searches keep it',()=>{
  const props={combinations:[],outwardResults:{},returnResults:{},expectedOutwardDays:1,expectedReturnDays:1,
    searchParams:{rueckfahrt:'1',reisezeitraumAb:first,reisezeitraumBis:addDaysToDateKey(first,1),minNaechte:'1'}}
  const normal=renderToStaticMarkup(createElement(TravelCombinations,props))
  assert.match(normal,/Keine passende Hin- und Rückfahrt-Kombination/)
  const failed=renderToStaticMarkup(createElement(TravelCombinations,{...props,hasSearchError:true}))
  assert.doesNotMatch(failed,/Keine passende Hin- und Rückfahrt-Kombination/)
})

test('Urlaubsfinder preserves upstream failures instead of claiming unavailable connections',async()=>{
  const {POST: holiday}=await import('../app/api/urlaubsfinder/route.ts')
  const date=addDaysToDateKey(first,97)
  failedDay=date
  failedDayResponse={status:403,body:{status:'ERROR',code:'OPS_BLOCKED'}}
  try {
    const res=await holiday(req({homeStation:'Berlin Hbf',destinations:['München Hbf'],outwardDate:date}))
    assert.equal(res.status,200)
    const events=(await res.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)))
    const unavailable=events.find(event=>event.type==='unavailable')?.data
    assert.ok(unavailable,'failed destination must be sent to the frontend')
    assert.equal(unavailable.error.kind,'blocked')
    assert.match(unavailable.reason,/HTTP 403, OPS_BLOCKED/)
    assert.doesNotMatch(unavailable.reason,/Keine Hinfahrt|Keine Rückfahrt/)
  } finally { failedDay=undefined;failedDayResponse={status:500,body:{}} }
})

test('round-trip progress and timeline retain the final day across the winter-time change',()=>{
  const previousTimeZone=process.env.TZ
  try {
    for(const timeZone of ['Europe/Berlin','UTC']) {
      process.env.TZ=timeZone
      const makeResults=(dates)=>Object.fromEntries(dates.map(date=>[date,{
        preis:date==='2026-10-28'?10:20,info:'',
        abfahrtsZeitpunkt:date+'T08:00:00+01:00',ankunftsZeitpunkt:date+'T12:00:00+01:00',
      }]))
      const markup=renderToStaticMarkup(createElement(TravelCombinations,{
        combinations:[],expectedOutwardDays:4,expectedReturnDays:4,
        outwardResults:makeResults(['2026-10-22','2026-10-23','2026-10-24','2026-10-25']),
        returnResults:makeResults(['2026-10-25','2026-10-26','2026-10-27','2026-10-28']),
        searchParams:{rueckfahrt:'1',reisezeitraumAb:'2026-10-22',reisezeitraumBis:'2026-10-28',
          minNaechte:'3',returnWochentage:'1,2,3,4,5,6,0'},
      }))
      assert.match(markup,/aria-label="8 von 8 Reisetagen geprüft"/,timeZone)
      assert.match(markup,/>100%<\//,timeZone)
      assert.match(markup,/aria-label="Rückfahrtsdatum verschieben" aria-valuetext="[^"]*28\.10\./,timeZone)
    }
  } finally {
    if(previousTimeZone===undefined) delete process.env.TZ
    else process.env.TZ=previousTimeZone
  }
})

function scrollHarness() {
  let nextId=0
  const callbacks=new Map(),scrolls=[]
  const frames={requestAnimationFrame(callback){callbacks.set(++nextId,callback);return nextId},cancelAnimationFrame(id){callbacks.delete(id)}}
  const state={isActive:true,autoScrollOnStart:true,hasAutoScrolled:{current:false}}
  const getPanel=()=>({scrollIntoView(options){scrolls.push(options)}})
  const flush=()=>{const current=[...callbacks.values()];callbacks.clear();current.forEach(callback=>callback(0))}
  return {frames,state,getPanel,flush,callbacks,scrolls}
}
test('an in-place route change never schedules the progress-panel scroll',()=>{
  const h=scrollHarness();h.state.autoScrollOnStart=false
  assert.equal(scheduleSearchProgressScroll(h.state,h.getPanel,h.frames),undefined)
  h.flush();h.flush()
  assert.equal(h.scrolls.length,0);assert.equal(h.callbacks.size,0)
})
test('a normal search still scrolls once after layout and resets for the next search',()=>{
  const h=scrollHarness()
  scheduleSearchProgressScroll(h.state,h.getPanel,h.frames)
  h.flush();assert.equal(h.scrolls.length,0)
  h.flush();assert.deepEqual(h.scrolls,[{behavior:'smooth',block:'start'}])
  assert.equal(scheduleSearchProgressScroll(h.state,h.getPanel,h.frames),undefined)
  scheduleSearchProgressScroll({...h.state,isActive:false},h.getPanel,h.frames)
  assert.equal(h.state.hasAutoScrolled.current,false)
  scheduleSearchProgressScroll(h.state,h.getPanel,h.frames);h.flush();h.flush()
  assert.equal(h.scrolls.length,2)
})
test('superseding a search or suppressing its auto-scroll cancels both layout frames',()=>{
  for(const afterFirstFrame of [false,true]) {
    const h=scrollHarness()
    const cleanup=scheduleSearchProgressScroll(h.state,h.getPanel,h.frames)
    if(afterFirstFrame)h.flush()
    cleanup();h.flush();h.flush()
    assert.equal(h.callbacks.size,0);assert.equal(h.scrolls.length,0)
  }
})

test('calendar keeps one loading phase through discovery and Flexpreis, including an extra day',()=>{
  const initial={hasResult:false,isFlexpreisView:true,isStreaming:true,isExpectedDay:true,isLazyLoading:false,showLazyLoading:false}
  assert.equal(getCalendarDayLoadingPhase(initial),'discovery')
  assert.equal(getCalendarDayLoadingPhase({...initial,hasResult:true,flexpreisStatus:'pending'}),'flexpreis')
  assert.equal(getCalendarDayLoadingPhase({...initial,hasResult:true,flexpreisStatus:'priced'}),null)
  const lazy={...initial,isStreaming:false,isExpectedDay:false,isLazyLoading:true,showLazyLoading:true}
  assert.equal(getCalendarDayLoadingPhase(lazy),'discovery')
  assert.equal(getCalendarDayLoadingPhase({...lazy,hasResult:true,flexpreisStatus:'pending'}),'flexpreis')
  // Even before the delayed indicator appears, a received pending quote is unambiguous.
  assert.equal(getCalendarDayLoadingPhase({...lazy,hasResult:true,showLazyLoading:false,flexpreisStatus:'pending'}),'flexpreis')
  assert.equal(getCalendarDayLoadingPhase({...lazy,hasResult:true,flexpreisStatus:'priced'}),null)
})
test('ordinary prices stay visible during Flexpreis lookup; terminal and cancelled states stop loading',()=>{
  const received={hasResult:true,flexpreisStatus:'pending',isFlexpreisView:true,isStreaming:true,isExpectedDay:true,isLazyLoading:false,showLazyLoading:false}
  assert.equal(getCalendarDayLoadingPhase({...received,isFlexpreisView:false}),null)
  assert.equal(getCalendarDayLoadingPhase({...received,isFlexpreisView:false,isLazyLoading:true,showLazyLoading:true}),null)
  for(const flexpreisStatus of ['priced','no_offer','missing_connection','unclear_route','error']) {
    assert.equal(getCalendarDayLoadingPhase({...received,flexpreisStatus}),null)
  }
  assert.equal(getCalendarDayLoadingPhase({...received,isStreaming:false}),null)
  assert.equal(getCalendarDayLoadingPhase({...received,isExpectedDay:false}),null)
  assert.equal(getCalendarDayLoadingPhase({...received,hasResult:false,isStreaming:false}),null)
})
