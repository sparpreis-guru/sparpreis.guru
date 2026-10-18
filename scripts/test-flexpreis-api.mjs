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
    const name = new URL(url).searchParams.get('suchbegriff')
    const extId = name==='Berlin Hbf'?'8011160':'8000261'
    return response([{extId,name,id:'A=1@O='+name+'@L='+extId+'@'}])
  }
  const body=JSON.parse(options.body)
  if (url.endsWith('/tagesbestpreis')) {
    calls.day++
    throwNetworkFailure('tagesbestpreis')
    const date=body.anfrageZeitpunkt.slice(0,10)
    if(date===failedDay) return response({},500)
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
    if(specifier.startsWith('@/') || (specifier.startsWith('.')&&context.parentURL?.startsWith(pathToFileURL(root).href))) {
      const base=specifier.startsWith('@/')?resolve(root,specifier.slice(2)):resolve(dirname(fileURLToPath(context.parentURL)),specifier)
      const path=[base,base+'.ts',base+'.tsx',base+'.js',resolve(base,'index.ts')].find(p=>existsSync(p)&&statSync(p).isFile())
      if(path) return {url:pathToFileURL(path).href+(path.endsWith('.json') && /\.tsx?$/.test(context.parentURL || '') ? '?esm' : ''),shortCircuit:true}
    }
    return next(specifier,context)
  },
  load(url, context, next) {
    if(url.endsWith('/app/api/search-prices/bahn-http.ts')) return {format:'module',shortCircuit:true,
      source:'export const fetchBahn=(...args)=>globalThis.__mockFlexFetch(...args)'}
    if(url.startsWith(pathToFileURL(root).href)&&!url.includes('/node_modules/')) {
      if(url.endsWith('.json?esm')) return {format:'module',shortCircuit:true,source:'export default '+readFileSync(fileURLToPath(url),'utf8')}
      if(/\.tsx?$/.test(url)) return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),
        {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText}
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
  const ordinaryCalendar=renderToStaticMarkup(createElement(PriceCalendar,{...props,tarif:'SPARPREIS'}))
  assert.match(ordinaryCalendar,/md:hidden">20€<\/span>/,'ordinary prices use the same compact calendar format')
  assert.match(ordinaryCalendar,/title="19,99 €"/)
  const row=renderToStaticMarkup(createElement(FlexpreisDayComparison,{data:priced}))
  assert.match(row,/Fahrtverlauf anzeigen/)
  assert.match(row,/Angebotsdetails anzeigen/)
  assert.match(row,/aria-controls=/)
  assert.match(row,/Bei der Bahn prüfen/)
  assert.match(row,/>Prüfen<\/span>/)
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
