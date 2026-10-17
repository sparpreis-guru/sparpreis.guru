# Datenbank und Wartung

Die Anwendung speichert Suchdaten standardmäßig in `data/connection-cache.db`. Mit `DATABASE_PATH` kann ein anderer Pfad festgelegt werden. Die separat heruntergeladene `data/direct-connections.db` gehört nicht zu den folgenden Wartungsbefehlen.

## Datenbereiche

| Bereich | Tabellen | Inhalt | Aufbewahrung |
| --- | --- | --- | --- |
| Verbindungscache | `connection_cache` | Gemeinsame Tagesbestpreis-Antworten sowie separat versionierte Flexpreis-Angebote und ergänzende Fahrplanseiten | 90 Tage; frisch für 60 Minuten, negative Flexpreis-Angebote für 10 Minuten |
| Stationssuche | `station_search_cache` | Ergebnisse der Bahnhofssuche je Suchbegriff | 7 Tage |
| Stationsnutzung | `station_search_usage` | Klickzahlen zur Sortierung bevorzugter Bahnhofstreffer | 180 Tage |
| Preishistorie | `price_history_context`, `price_history_journey`, `price_history_observation` | Beobachtete Preise je Suchkontext und Verbindung | Beobachtungen 90 Tage; vergangene Reisetage werden zusätzlich automatisch entfernt |

Tagesbestpreis-Suchen verwenden unabhängig von der Flexpreis-Auswahl denselben Cache-Schlüssel. Die kompatible optionale Payload-Erweiterung `flexpreisSources` speichert beobachtete Verbindungen vor der Preisfilterung einschließlich Haltefolge und Rekonstruktionskennung. Diese Kennungen bleiben serverseitig. Umstiegs- und Zeitfilter werden beim Lesen angewandt. Alte Einträge ohne diese Kandidaten bleiben für Bestpreis-Suchen nutzbar; eine Flexpreis-Suche erneuert sie einmalig. Frühere separate `FLEXPREIS`-Einträge werden nicht mehr ausgewertet und unterliegen weiterhin der normalen Aufbewahrung.

Flexpreis-Angebote liegen ebenfalls gzip-komprimiert in `connection_cache`, aber mit einem separaten JSON-Schlüssel: `kind: "flexpreis-offer"`, `version: 1`, `date`, konkrete Verbindungsidentität (Halte, Zeiten, Züge und Produktklasse) sowie Wagenklasse, Altersgruppe und BahnCard-Kontext. Die Payload enthält Status und gegebenenfalls den in Cent gespeicherten Preis, Angebotsnamen, Bedingungen, geprüfte Verbindung und Abfragezeit. Es wird kein Preis auf ähnliche Fahrten übertragen. Positive Antworten sind 60 Minuten frisch, bestätigte Antworten ohne passendes Angebot nur 10 Minuten. Technische Fehler werden nicht gespeichert. Erfolgreiche Einzelabfragen bleiben erhalten, auch wenn eine weitere Abfrage scheitert. Eine erfolgreiche erneute Prüfung ersetzt ältere Anzeigeergebnisse derselben Verbindung auch bei bestätigtem fehlendem Angebot. Bei Teilfehlern werden nur nicht erfolgreich neu geprüfte Beobachtungen beibehalten; die Tagesantwort nennt dafür optional die erfolgreich geprüften Verbindungskennungen (`checkedConnectionKeys`). Fehler bereits bei der Verbindungssuche werden ausdrücklich als technische Fehler ausgegeben und lösen keine ergänzende Fahrplanabfrage aus. Gleichzeitige identische Preisabfragen werden innerhalb derselben Suchsession zusammengeführt; sessionübergreifende Abbrüche werden nicht gekoppelt.

Bei einem fehlenden Vergleichstreffer kann einmalig eine ergänzende Fahrplanseite abgefragt werden. Deren eigener Schlüssel verwendet `kind: "flexpreis-timetable"`, `version: 1`, `date`, Bahnhöfe und Abfrageparameter; die Seite bleibt 60 Minuten frisch und bildet ausdrücklich keinen vollständigen Tagesfahrplan ab. Beide neuen Schlüssel behalten das Feld `date`, damit die bestehende Bereinigung vergangener Reisetage unverändert greift. Die Aufbewahrungsfrist beträgt weiterhin 90 Tage. Es gibt keine neuen Tabellen, Indizes oder inkompatiblen Formate und daher keine neue Schema-Migration.

Im Kalender wird höchstens eine Vergleichsverbindung pro Tag bepreist. Weitere Angebote werden nur auf Wunsch im Tagesdetail geprüft (höchstens fünf beobachtete Wege). Tagesbestpreis-/Fahrplanabfragen und `recon` verwenden getrennte Rate-Limiter; die Fortschrittsanzeige zählt ausstehende Arbeiten je Queue. Ein Ansichts- oder Tarifwechsel und wiederholte warme Suchen verwenden vorhandene Daten. Flexpreis-Angebote werden nicht in die Bestpreis-Historie geschrieben; diese erfasst die Tagesbestpreis-Verbindungen weiterhin einmalig.

Die tatsächliche Nutzung des Angebots- und ergänzenden Fahrplan-Caches wird über `flexpreis_cache_hits_total{kind}` und `flexpreis_cache_misses_total{kind}` erfasst (`kind="offer"` beziehungsweise `"timetable"`), zusätzlich zu den bisherigen Cache-Gesamtzählern. Reine Prüfungen für die Fortschrittsschätzung und zusammengeführte parallele Angebotsabfragen werden nicht zusätzlich gezählt. Die zugehörigen API-Metriken sind im Monitoring-Abschnitt der `README.md` beschrieben. Diese Instrumentierung verändert weder Cache-Schlüssel und Payloads noch Fristen, Tabellen oder Wartungsbefehle; sie benötigt keine Schema-Migration.

Die Stationssuche berücksichtigt die Aufbewahrungszeit bereits beim Lesen. Beim Aktualisieren eines Suchbegriffs wird dessen bisherige Ergebnismenge vollständig ersetzt. Die Klicksortierung liegt getrennt davon und bleibt dabei erhalten.

## Schema und Migrationen

Das Schema ist über `PRAGMA user_version` versioniert. Nummerierte Migrationen liegen unter `lib/database/migrations`; `lib/database/database-schema.json` enthält die aktuell unterstützte Version. `schema_migrations` protokolliert die angewendeten Migrationen.

Inkompatible Änderungen am Datenbankformat benötigen immer eine neue, fortlaufende Datenbankversion und eine Migration. Vorhandene Migrationen werden nachträglich nicht verändert. Beim Anwendungsstart werden ausstehende Migrationen automatisch ausgeführt; Migrationen mit entsprechendem Risiko erzeugen vorher ein konsistentes Backup.

`predev`, `prestart` und der Docker-Entrypoint verwenden dafür `database:prepare`. Dieser Vorbereitungsschritt führt zuerst die verpflichtende Migration aus und bereinigt danach abgelaufene Daten, bevor der Server Anfragen annimmt. Ein Migrationsfehler verhindert den Start. Ein Fehler bei der anschließenden Bereinigung wird protokolliert, blockiert den Serverstart aber nicht: Pruning ist eine Wartungsoperation, und eine fehlgeschlagene Transaktion lässt die vorhandenen Daten unverändert.

```powershell
corepack pnpm database:prepare
```

Das Startup-Pruning ist nicht vom ersten Aufruf einer Suchroute abhängig. Bei lang laufenden Servern werden die Aufbewahrungsregeln zusätzlich alle sechs Stunden angewendet; vergangene Reisetage werden weiterhin täglich bereinigt.

```powershell
corepack pnpm database:migrate
```

Ein abweichender Pfad gilt für alle Befehle:

```powershell
$env:DATABASE_PATH = 'D:\sparpreis-guru\connection-cache.db'
corepack pnpm database:stats
```

## Statistiken und Integritätsprüfung

`database:stats` arbeitet nur lesend. Der Befehl zeigt unter anderem Schema-Version, Datei- und WAL-Größe, freie SQLite-Seiten, Zeilenzahlen, Zeiträume sowie die durch die Aufbewahrungsregeln abgelaufenen Einträge.

```powershell
corepack pnpm database:stats
```

`database:check` führt eine vollständige SQLite-Integritätsprüfung und eine Fremdschlüsselprüfung aus.

```powershell
corepack pnpm database:check
```

## Abgelaufene Daten bereinigen

`database:prune` entfernt Daten, deren jeweilige Aufbewahrungszeit abgelaufen ist. Dazu gehören auch Verbindungscaches und Preishistorien für Reisetage vor dem aktuellen Datum in `Europe/Berlin`. Verwaiste Preishistorien-Verbindungen und -Kontexte werden anschließend ebenfalls entfernt. Mit `CLEANUP_PAST_CONNECTIONS=false` bleibt die Bereinigung vergangener Reisetage deaktiviert; die zeitbasierten Aufbewahrungsfristen gelten weiterhin.

Ohne `--yes` zeigt der Befehl nur eine Vorschau und beendet sich mit Exit-Code `2`:

```powershell
corepack pnpm database:prune
```

Ein ausdrücklich angeforderter Dry-Run verändert ebenfalls nichts, gilt aber mit Exit-Code `0` als erfolgreich:

```powershell
corepack pnpm database:prune --dry-run
```

Erst `--yes` führt die Bereinigung aus:

```powershell
corepack pnpm database:prune --yes
```

## Datenbereiche gezielt leeren

`database:clear` verlangt genau einen Scope. Es gibt absichtlich keinen pauschalen `all`-Scope.

| Scope | Gelöschte Daten | Bewusst nicht betroffen |
| --- | --- | --- |
| `station-search` | Gecachte Ergebnisse der Bahnhofssuche | Erlernte Klicksortierung |
| `station-usage` | Klickzahlen und bevorzugte Bahnhofstreffer | Gecachte Bahnhofsergebnisse |
| `connections` | Komprimierte Verbindungssuchen | Preishistorie und Stationsdaten |
| `price-history` | Kontexte, Verbindungen und Beobachtungen der Preishistorie | Verbindungscache und Stationsdaten |

Vorschau:

```powershell
corepack pnpm database:clear --scope=station-search
```

Expliziter Dry-Run:

```powershell
corepack pnpm database:clear --scope=station-search --dry-run
```

Ausführen:

```powershell
corepack pnpm database:clear --scope=station-search --yes
```

Für `connections` entstehen nach dem Leeren wieder echte Anfragen an die Bahn-Schnittstelle. `price-history` löscht fachliche Verlaufsdaten und sollte nur bewusst verwendet werden. `direct-connections.db`, `schema_migrations` und unbekannte Tabellen werden durch keinen Scope verändert.

## Sicherheitsverhalten

- `--yes` und `--dry-run` können nicht gemeinsam verwendet werden.
- Vor jeder Änderung werden Datenbankpfad, Kommando, Scope und betroffene Zeilen ausgegeben.
- Änderungen laufen in einer SQLite-Transaktion mit aktivierten Fremdschlüsseln.
- Nach einer Änderung werden die tatsächlich entfernten Zeilen und das Ergebnis der Fremdschlüsselprüfung ausgegeben.
- Bei einem unerwarteten Schema bricht die Wartung ab und verlangt zuerst eine Migration.
- Bei Fehlern endet der Befehl mit Exit-Code `1`.
- Der automatische Vorbereitungsschritt ruft das Pruning intern ausdrücklich mit `--yes` auf. Nur dieser Startpfad behandelt einen Pruning-Fehler als Warnung und setzt den Serverstart fort.

Die Schreibbefehle funktionieren mit SQLite-WAL, sollten für eindeutig reproduzierbare Ergebnisse aber möglichst bei angehaltener Anwendung oder in einem Wartungsfenster laufen. Eine aktive Anwendung kann geleerte Caches unmittelbar wieder befüllen.

`DELETE` gibt SQLite-Seiten zur Wiederverwendung frei, verkleinert die Datenbankdatei aber nicht zwingend sofort. Ein manuelles `VACUUM` gehört nicht zu diesen Befehlen und sollte nur offline, nach einem konsistenten Backup und einer Integritätsprüfung ausgeführt werden.

## Docker

Im Produktions-Image steht das Wartungsskript direkt zur Verfügung. Da der schlanke Runtime-Container keinen pnpm-Wrapper benötigt, werden Befehle dort mit Node ausgeführt:

```bash
docker exec <container> node /app/scripts/database-maintenance.cjs stats
docker exec <container> node /app/scripts/database-maintenance.cjs clear --scope=station-search --dry-run
docker exec <container> node /app/scripts/database-maintenance.cjs clear --scope=station-search --yes
```

Der konfigurierte `/app/data`-Mount und `DATABASE_PATH` gelten auch für diese Aufrufe.
