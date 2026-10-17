import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {buildFlexpreisSource, chooseFlexpreisComparison, comparisonSource, flexpreisCellAmount,
  flexpreisQuoteCacheKey, mergeFlexpreisDays, selectFlexpreisSamples, formatFlexpreisBasisOccurrences,
  formatFlexpreisTypicalDuration, formatFlexpreisTypicalTransfers, getFlexpreisRouteLabels, rebaseFlexpreisResults} from '../lib/search/flexpreis-comparison.ts'
import {parseFlexpreisOffer} from '../lib/search/flexpreis-offers.ts'
import {passesTimeFilter} from '../lib/shared/journey-time-filter.ts'
import {buildFlexpreisRoute} from '../lib/search/flexpreis-routing.ts'
import {getEligibleDateKeys,parseSearchWeekdays} from '../lib/search/return-search-feasibility.ts'
import {formatCompactPrice,formatPrice} from '../lib/shared/format-price.ts'

test('compact calendar prices round to whole euros without changing precise prices',()=>{
  for(const [amount,expected] of [[19.99,'20€'],[99.5,'100€'],[106.3,'106€'],[172.2,'172€'],[299.99,'300€']]) {
    assert.equal(formatCompactPrice(amount),expected)
  }
  assert.equal(formatPrice(106.3),'106,30 €')
  assert.equal(formatPrice(172.2),'172,20 €')
  assert.equal(formatCompactPrice(0.1),'<1€')
  for(const invalid of [undefined,null,NaN,Infinity,-Infinity,0,-1]) {
    assert.equal(formatCompactPrice(invalid),'–')
    assert.equal(formatPrice(invalid),'–')
  }
})

const context={klasse:'KLASSE_2',alter:'ERWACHSENER',ermaessigungArt:'KEINE_ERMAESSIGUNG',ermaessigungKlasse:'KLASSENLOS'}
function source(date, via=['Erfurt','Nürnberg'], {product='ICE', duration=240, departure='08:00', suffix=''}={}) {
  const start=date+'T'+departure+':00',end=date+'T12:00:00'
  return buildFlexpreisSource({ctxRecon:'anonymous-test-handle',umstiegsAnzahl:0,verbindungsDauerInSeconds:duration*60,
    verbindungsAbschnitte:[{abfahrtsOrt:'Berlin',ankunftsOrt:'München',abfahrtsOrtExtId:'8011160',ankunftsOrtExtId:'8000261',
      abfahrt:{sollzeit:start},ankunft:{sollzeit:end},halte:[{name:'Berlin',extId:'8011160'},...via.map(name=>({name,extId:'id-'+name})),{name:'München',extId:'8000261'}],
      verkehrsmittel:{name:product+' 100'+suffix,kategorie:product,produktGattung:product}}]})
}
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/flexpreis-recon.json',import.meta.url)))
test('changing the comparison keeps ordinary results and extra days but never reuses an old Flexpreis',()=>{
  const oldDay={version:1,basisId:'old',status:'priced',comparisonQuote:{amountCents:17220},quotes:[{amountCents:17220}],alternativesStatus:'complete'}
  const input={_meta:{flexComparison:{basis:{id:'old'}}},
    '2026-10-20':{preis:19.99,allIntervals:[{preis:19.99}],flexpreis:oldDay},
    '2026-11-02':{preis:29.99,flexpreis:oldDay}}
  const changed=rebaseFlexpreisResults(input,'new')
  assert.deepEqual(Object.keys(changed),Object.keys(input))
  assert.equal(changed._meta,input._meta)
  for(const date of ['2026-10-20','2026-11-02']) {
    assert.equal(changed[date].preis,input[date].preis)
    assert.equal(changed[date].allIntervals,input[date].allIntervals)
    assert.equal(changed[date].flexpreis.basisId,'new')
    assert.equal(changed[date].flexpreis.status,'pending')
    assert.equal(changed[date].flexpreis.comparisonQuote,undefined)
    assert.deepEqual(changed[date].flexpreis.quotes,[])
    assert.equal(flexpreisCellAmount(changed[date].flexpreis,'new'),undefined)
  }
  assert.equal(input['2026-10-20'].flexpreis.status,'priced','previous state is not mutated')
})
test('calendar progress retains the final day across Berlin winter-time change',()=>{
  assert.deepEqual(getEligibleDateKeys('2026-10-20','2026-10-26',parseSearchWeekdays()),
    ['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25','2026-10-26'])
  assert.deepEqual(getEligibleDateKeys('2026-10-20','2026-10-26',parseSearchWeekdays('1,2,3,4,5')),
    ['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-26'])
  assert.equal(getEligibleDateKeys('2026-03-24','2026-03-30',parseSearchWeekdays()).length,7)
})
for(const f of fixtures.snapshots) test('real Recon fare: '+f.context.ermaessigungArt+' / '+f.context.klasse,()=>{
  assert.equal(parseFlexpreisOffer(f.offers,f.context)?.amountCents,f.expectedCents)
})

test('a discounted Probe-BahnCard add-on is not a normal fare without a card',()=>{
  const f=fixtures.snapshots[0]
  const discounted=f.offers.filter(o=>o.hinfahrt.fahrtAngebote.some(x=>x.streichpreis))
  assert.equal(parseFlexpreisOffer(discounted,f.context),null)
})
test('partial, expired, unbookable or bundled fares are not accepted',()=>{
  const original=fixtures.snapshots[0].offers.find(o=>o.klasse==='KLASSE_2'&&!o.hinfahrt.fahrtAngebote[0].streichpreis)
  for(const change of [o=>o.teilpreis=true,o=>o.angebotAbgelaufen=true,o=>o.hinfahrt.fahrtAngebote[0].teilpreisDetails={},
    o=>o.hinfahrt.fahrtAngebote[0].buchbarkeit='NICHT_BUCHBAR',o=>o.hinfahrt.fahrtAngebote.push({name:'Probe BahnCard'})]) {
    const o=structuredClone(original);change(o);assert.equal(parseFlexpreisOffer([o],context),null)
  }
})
test('calendar basis does not switch to a cheaper night route on another day',()=>{
  const fast=source('2026-10-20'),night=source('2026-10-21',['Jena','Saalfeld'],{duration:465})
  const selected=chooseFlexpreisComparison({'2026-10-20':[fast],'2026-10-21':[fast,night]})
  assert.equal(selected.basis.id,fast.route.key)
  assert.equal(comparisonSource([night],selected.basis.id),undefined)
  const wrong={version:1,basisId:night.route.key,status:'priced',quotes:[],comparisonQuote:{amountCents:1000}}
  assert.equal(flexpreisCellAmount(wrong,fast.route.key),undefined)
})
test('occurrence counts deduplicate journeys and distinguish frequency from days with evidence',()=>{
  const first=source('2026-10-20'), next=source('2026-10-21')
  const frequent=Array.from({length:5},(_,i)=>source('2026-10-20',['Jena','Saalfeld'],{suffix:String(i),duration:300}))
  const result=chooseFlexpreisComparison({'2026-10-20':[first,first,...frequent],'2026-10-21':[next],'2026-10-22':[]})
  assert.equal(result.basis.id,first.route.key)
  assert.equal(result.basis.connectionCount,2);assert.equal(result.basis.dayCount,2);assert.equal(result.totalDays,3)
  assert.equal(result.bases[1].connectionCount,5);assert.equal(result.bases[1].dayCount,1)
  assert.equal(formatFlexpreisBasisOccurrences(result.basis,3),'2 Verbindungen · an 2 von 3 Reisetagen')
  assert.equal(formatFlexpreisBasisOccurrences({...result.basis,connectionCount:1,dayCount:1},1),'1 Verbindung · an 1 von 1 Reisetag')
})
test('equal day availability still selects the fastest, not the most numerous variant',()=>{
  const fast=source('2026-10-20'), frequent=Array.from({length:5},(_,i)=>source('2026-10-20',['Jena','Saalfeld'],{suffix:String(i),duration:300}))
  const result=chooseFlexpreisComparison({date:[fast,...frequent]})
  assert.equal(result.basis.id,fast.route.key);assert.equal(result.bases[1].connectionCount,5)
})
test('typical duration is the median of unique journeys, not the fastest or the mean',()=>{
  const observed=[120,180,240,600].map((duration,i)=>source('2026-10-20',undefined,{duration,suffix:String(i)}))
  const even=chooseFlexpreisComparison({date:[...observed,...Array(10).fill(observed[0])]})
  assert.equal(even.basis.connectionCount,4)
  assert.equal(even.basis.typicalDurationMinutes,210)
  assert.equal(formatFlexpreisTypicalDuration(even.basis.typicalDurationMinutes),'ca. 3 h 30 min')
  assert.equal(chooseFlexpreisComparison({date:[...observed,source('2026-10-21',undefined,{duration:300})]}).basis.typicalDurationMinutes,240)
  const other=source('2026-10-20',['Jena','Saalfeld'],{duration:400})
  const separate=chooseFlexpreisComparison({date:[...observed,other]})
  assert.equal(separate.bases.find(b=>b.id===other.route.key).typicalDurationMinutes,400)
})
test('unknown or invalid durations do not become made-up typical travel times',()=>{
  const invalid=[null,0,NaN,Infinity,-5].map((duration,i)=>{
    const s=source('2026-10-20',undefined,{suffix:'unknown'+i});s.route.durationMinutes=duration;return s
  })
  assert.equal(chooseFlexpreisComparison({date:invalid}).basis.typicalDurationMinutes,null)
  const known=source('2026-10-20',undefined,{duration:145,suffix:'known'})
  assert.equal(chooseFlexpreisComparison({date:[...invalid,known]}).basis.typicalDurationMinutes,145)
  for(const value of [undefined,null,0,NaN,Infinity,-1,0.1]) assert.equal(formatFlexpreisTypicalDuration(value),'–')
  assert.equal(formatFlexpreisTypicalDuration(60),'ca. 1 h')
  assert.equal(formatFlexpreisTypicalDuration(45),'ca. 45 min')
})
test('typical transfers are the mode of unique journeys, with fewer changes breaking a tie',()=>{
  const journeys=[0,1,1,2].map((transfers,i)=>{
    const s=source('2026-10-20',undefined,{suffix:'transfers'+i});s.route.transfers=transfers;return s
  })
  const result=chooseFlexpreisComparison({date:[...journeys,...Array(10).fill(journeys[0])]})
  assert.equal(result.basis.typicalTransfers,1)
  assert.equal(result.basis.connectionCount,4)
  const tied=chooseFlexpreisComparison({date:[journeys[0],journeys[1],journeys[3]]})
  assert.equal(tied.basis.typicalTransfers,0)
  const unknown=journeys.map((s,i)=>({...s,route:{...s.route,transfers:[null,-1,1.5,NaN][i]}}))
  assert.equal(chooseFlexpreisComparison({date:unknown}).basis.typicalTransfers,null)
  assert.equal(formatFlexpreisTypicalTransfers(0),'Direkt')
  assert.equal(formatFlexpreisTypicalTransfers(1),'1 Umstieg')
  assert.equal(formatFlexpreisTypicalTransfers(3),'3 Umstiege')
  for(const value of [undefined,null,-1,1.5,NaN,Infinity])assert.equal(formatFlexpreisTypicalTransfers(value),'–')
})
test('truncated Fulda–Berlin labels retain Halle/Leipzig differences without merging paths',()=>{
  const halle=source('2026-10-20',['Eisenach Hbf','Erfurt Hbf','Halle(Saale)Hbf','Berlin Südkreuz'])
  const leipzig=source('2026-10-20',['Eisenach Hbf','Erfurt Hbf','Leipzig Hbf','Lutherstadt Wittenberg Hbf','Berlin Südkreuz'])
  const result=chooseFlexpreisComparison({date:[halle,leipzig]})
  assert.equal(result.bases.length,2);assert.notEqual(result.bases[0].label,result.bases[1].label)
  assert.ok(result.bases.find(b=>b.id===halle.route.key).label.includes('Halle'))
  assert.ok(result.bases.find(b=>b.id===leipzig.route.key).label.includes('Leipzig'))
  const labels=getFlexpreisRouteLabels([halle.route,leipzig.route])
  for(const basis of result.bases) assert.equal(labels.get(basis.id),basis.label)
  const reversed=chooseFlexpreisComparison({date:[leipzig,halle]})
  assert.deepEqual(result,reversed)
})
test('observed IDs, product class and missing route evidence remain distinct',()=>{
  const ice=source('2026-10-20'),ic=source('2026-10-20',undefined,{product:'IC'})
  assert.notEqual(ice.route.key,ic.route.key)
  const noStops=source('2026-10-20',[])
  assert.equal(chooseFlexpreisComparison({date:[noStops]}).basis,undefined)
  const changed=structuredClone(ice);changed.route.viaStations[0].extId='different-actual-station'
  // Different provider IDs must not be merged by their otherwise identical names.
  const renamed=buildFlexpreisSource({ctxRecon:'x',verbindungsAbschnitte:[{abfahrtsOrt:'Berlin',ankunftsOrt:'München',
    abfahrt:{sollzeit:'2026-10-20T08:00:00'},ankunft:{sollzeit:'2026-10-20T12:00:00'},
    halte:[ice.route.origin,...changed.route.viaStations,ice.route.destination],verkehrsmittel:{kategorie:'ICE'}}]})
  assert.notEqual(renamed.route.key,ice.route.key)
})
test('a failed additional lookup preserves the comparison quote',()=>{
  const s=source('2026-10-20'),q={connectionKey:s.connectionKey,amountCents:19610}
  const previous={version:1,basisId:s.route.key,status:'priced',comparisonQuote:q,quotes:[q],alternativesStatus:'idle'}
  const failed={version:1,basisId:s.route.key,status:'error',quotes:[],alternativesStatus:'partial'}
  const merged=mergeFlexpreisDays(previous,failed)
  assert.equal(merged.status,'priced');assert.equal(merged.quotes.length,1)
  assert.equal(flexpreisCellAmount(merged,s.route.key),196.1)
})
test('successful checks without an offer discard previous comparison prices',()=>{
  const s=source('2026-10-20'),q={connectionKey:s.connectionKey,amountCents:19610}
  const previous={version:1,basisId:s.route.key,status:'priced',comparisonQuote:q,quotes:[q],alternativesStatus:'complete'}
  for(const status of ['no_offer','missing_connection','unclear_route']) {
    const next={version:1,basisId:s.route.key,status,quotes:[],alternativesStatus:'complete'}
    assert.deepEqual(mergeFlexpreisDays(previous,next),next)
    assert.equal(flexpreisCellAmount(mergeFlexpreisDays(previous,next),s.route.key),undefined)
  }
})
test('partial failures preserve only observations without a successful new check',()=>{
  const q={connectionKey:'primary',amountCents:19610},unavailable={connectionKey:'unavailable',amountCents:15000}
  const failed={connectionKey:'failed',amountCents:17000}
  const previous={version:1,basisId:'basis',status:'priced',comparisonQuote:q,quotes:[q,unavailable,failed],alternativesStatus:'complete'}
  const next={version:1,basisId:'basis',status:'no_offer',quotes:[],checkedConnectionKeys:['primary','unavailable'],alternativesStatus:'partial'}
  const merged=mergeFlexpreisDays(previous,next)
  assert.equal(merged.status,'no_offer');assert.equal(merged.comparisonQuote,undefined)
  assert.deepEqual(merged.quotes,[failed])
})
test('route identity retains local tails and different intermediate stops',()=>{
  const leg=(names,product='ICE')=>({abfahrtsOrt:names[0],ankunftsOrt:names.at(-1),halte:names.map(name=>({name})),verkehrsmittel:{kategorie:product}})
  const route=legs=>buildFlexpreisRoute(legs,0,'2026-10-20T08:00:00','2026-10-20T12:00:00')
  const direct=route([leg(['Köln','Düsseldorf','Bremen','Hamburg'])])
  const tail=route([leg(['Köln','Düsseldorf','Bremen']),leg(['Bremen','Hamburg'],'RE')])
  const alternate=route([leg(['Köln','Hannover','Hamburg'])])
  assert.equal(direct.key,tail.key)
  assert.notEqual(direct.key,alternate.key)
  assert.notEqual(direct.key,route([leg(['Köln','Düsseldorf','Bremen','Hamburg'],'IC')]).key)
})
test('unsupported operators are excluded and unknown durations stay unknown',()=>{
  const base={ctxRecon:'handle',verbindungsAbschnitte:[{abfahrtsOrt:'A',ankunftsOrt:'B',
    abfahrt:{sollzeit:'2026-10-20T08:00:00'},ankunft:{sollzeit:'2026-10-20T12:00:00'},
    verkehrsmittel:{kategorie:'DRF',produktGattung:'IR',name:'FLX 1800'}}]}
  assert.equal(buildFlexpreisSource(base),null)
  const route=buildFlexpreisRoute([{abfahrtsOrt:'A',ankunftsOrt:'B',verkehrsmittel:{kategorie:'ICE'}}],0,'invalid','invalid')
  assert.equal(route.durationMinutes,null)
})
test('cache identity is per journey, day and fare context; never a similar route',()=>{
  const a=source('2026-10-20'),b=source('2026-10-21')
  assert.notEqual(flexpreisQuoteCacheKey(a,context),flexpreisQuoteCacheKey(b,context))
  assert.notEqual(flexpreisQuoteCacheKey(a,context),flexpreisQuoteCacheKey(a,{...context,ermaessigungArt:'BAHNCARD50'}))
  assert.equal(flexpreisQuoteCacheKey(a,context),flexpreisQuoteCacheKey(a,{...context,sessionId:'another-session'}))
})
test('requests are bounded and retain other product classes and distinctive paths',()=>{
  const main=source('2026-10-20'),ic=source('2026-10-20',['IC-Weg'],{product:'IC',duration:350})
  const night=source('2026-10-20',['Jena','Saalfeld'],{duration:465})
  const result=selectFlexpreisSamples([main,ic,night,...Array.from({length:8},(_,i)=>source('2026-10-20',['Erfurt','Zusatzhalt'+i,'Nürnberg']))],main)
  assert.equal(result.length,5);assert.equal(result[0],main);assert.ok(result.includes(ic));assert.ok(result.includes(night))
})
test('Berlin time filters handle offsets and overnight arrivals independently of host TZ',()=>{
  assert.equal(passesTimeFilter('2026-10-20T08:00:00Z','2026-10-20T12:00:00Z',{abfahrtAb:'09:30'}),true)
  assert.equal(passesTimeFilter('2026-10-20T08:00:00','2026-10-20T12:00:00',{abfahrtAb:'09:30'}),false)
  assert.equal(passesTimeFilter('2026-10-20T23:28:00','2026-10-21T07:13:00',{ankunftBis:'12:00'}),false)
  assert.equal(passesTimeFilter('2026-10-20T23:28:00','2026-10-21T07:13:00',{abfahrtAb:'22:00',ankunftBis:'08:00'}),true)
})
