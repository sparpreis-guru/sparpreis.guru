import { NextRequest, NextResponse } from "next/server"
import { getBestPrice, searchBahnhof } from "@/app/api/search-prices/bahn-api"
import { resolveFlexpreisDay, supplementFlexpreisSources, type FlexpreisRequestConfig } from "@/app/api/search-prices/flexpreis"
import { cancelBestpreisSearchSession, globalRateLimiter } from "@/app/api/search-prices/rate-limiter"
import { addDaysToDateKey, getEarliestSearchDateKey } from "@/lib/shared/berlin-date"
import { comparisonSource } from "@/lib/search/flexpreis-comparison"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  let sessionId: string | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const abort = () => { if (sessionId) cancelBestpreisSearchSession(sessionId, "user_request") }
  try {
    const body = await request.json()
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 })
    const date = body.date
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      addDaysToDateKey(date, 0) !== date || date < getEarliestSearchDateKey() ||
      typeof body.start !== "string" || !body.start || body.start.length > 200 ||
      typeof body.ziel !== "string" || !body.ziel || body.ziel.length > 200 ||
      (body.flexBasisId !== undefined && (typeof body.flexBasisId !== "string" || body.flexBasisId.length > 8192))) {
      return NextResponse.json({ error: "Ungültiger Reisetag, Bahnhof oder Vergleichsreiseweg." }, { status: 400 })
    }
    const klasses = ["KLASSE_1", "KLASSE_2"], ages = ["ERWACHSENER", "KIND", "JUGENDLICHER", "SENIOR"]
    const cards = ["KEINE_ERMAESSIGUNG", "BAHNCARD25", "BAHNCARD50"]
    if (!klasses.includes(body.klasse || "KLASSE_2") || !ages.includes(body.alter || "ERWACHSENER") ||
      !cards.includes(body.ermaessigungArt || "KEINE_ERMAESSIGUNG") ||
      !["KLASSENLOS", ...klasses].includes(body.ermaessigungKlasse || "KLASSENLOS")) {
      return NextResponse.json({ error: "Diese Tarifparameter werden nicht unterstützt." }, { status: 400 })
    }
    for (const field of ["abfahrtAb", "abfahrtBis", "ankunftAb", "ankunftBis"]) {
      if (body[field] && (typeof body[field] !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body[field]))) {
        return NextResponse.json({ error: "Ungültiges Zeitfenster." }, { status: 400 })
      }
    }
    if (body.maximaleUmstiege !== undefined && body.maximaleUmstiege !== "alle" && (!Number.isInteger(Number(body.maximaleUmstiege)) ||
      Number(body.maximaleUmstiege) < 0 || Number(body.maximaleUmstiege) > 10)) {
      return NextResponse.json({ error: "Ungültige Umstiegszahl." }, { status: 400 })
    }
    if (body.umstiegszeit !== undefined && body.umstiegszeit !== "normal" &&
      (!/^\d{1,3}$/.test(String(body.umstiegszeit)) || Number(body.umstiegszeit) > 120)) {
      return NextResponse.json({ error: "Ungültige Umstiegszeit." }, { status: 400 })
    }
    const [startStation, zielStation] = await Promise.all([searchBahnhof(body.start), searchBahnhof(body.ziel)])
    if (!startStation || !zielStation) return NextResponse.json({ error: "Bahnhof nicht gefunden." }, { status: 404 })
    const requestSessionId: string = typeof body.sessionId === "string" && body.sessionId.length > 0 && body.sessionId.length <= 128 ? body.sessionId : crypto.randomUUID()
    sessionId = requestSessionId
    request.signal.addEventListener("abort", abort, { once: true })
    globalRateLimiter.registerSearchSession(requestSessionId, 7, 7)
    heartbeat = setInterval(() => globalRateLimiter.heartbeatSearchSession(sessionId!, 7, 7), 10_000)
    const config: FlexpreisRequestConfig = {
      sessionId, startStation, zielStation, klasse: body.klasse || "KLASSE_2", alter: body.alter || "ERWACHSENER",
      ermaessigungArt: body.ermaessigungArt || "KEINE_ERMAESSIGUNG", ermaessigungKlasse: body.ermaessigungKlasse || "KLASSENLOS",
      maximaleUmstiege: body.maximaleUmstiege, umstiegszeit: body.umstiegszeit,
      schnelleVerbindungen: body.schnelleVerbindungen === true || body.schnelleVerbindungen === "1" || body.schnelleVerbindungen === "true",
      abfahrtAb: body.abfahrtAb, abfahrtBis: body.abfahrtBis, ankunftAb: body.ankunftAb, ankunftBis: body.ankunftBis,
    }
    const discovered = await getBestPrice({ ...config, tarif: "FLEXPREIS", anfrageDatum: new Date(`${date}T12:00:00Z`),
      abfahrtsHalt: startStation.id, ankunftsHalt: zielStation.id,
      startStationNormalizedId: startStation.normalizedId, zielStationNormalizedId: zielStation.normalizedId })
    if (discovered.error) throw new Error("Connection discovery failed")
    let sources = discovered.flexpreisSources || []
    let supplementFailed = false
    if (!comparisonSource(sources, body.flexBasisId)) {
      try { sources = [...sources, ...await supplementFlexpreisSources(date, config)] }
      catch { supplementFailed = true }
    }
    const flexpreis = await resolveFlexpreisDay(sources, config, body.flexBasisId, true)
    if (supplementFailed) flexpreis.alternativesStatus = "partial"
    return NextResponse.json({ date, flexpreis })
  } catch {
    return NextResponse.json({ error: "Die Flexpreise konnten nicht geprüft werden. Versuche es erneut." }, { status: 503 })
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    request.signal.removeEventListener("abort", abort)
    if (sessionId) globalRateLimiter.unregisterSearchSession(sessionId)
  }
}
