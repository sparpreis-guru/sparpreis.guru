# sparpreis.guru

[sparpreis.guru](https://sparpreis.guru) findet günstige Bahnreisen über flexible Reisetage. Neben der Bestpreissuche für feste Strecken bietet die App einen Urlaubsfinder für offene Ziele und eine Karte aller direkt erreichbaren Bahnhöfe.

## Funktionen

- **Bestpreissuche:** Vergleicht Verbindungen an bis zu 30 ausgewählten Reisetagen. Filter für Wochentage, Reisezeiten, Alter, BahnCard, Klasse und Umstiege grenzen die Suche ein; Kalender und Tagesansicht zeigen Preise, Fahrtverläufe, Buchungslinks und – sofern vorhanden – die Preisentwicklung.
- **Flexible Hin- und Rückfahrt:** Kombiniert günstige Fahrten anhand der gewünschten Aufenthaltsdauer. Ergebnisse erscheinen als Preismatrix und sortierbare Liste mit Gesamtpreis, Reisedauer und Hinweisen auf reine Direktverbindungen.
- **Klassikmodus:** Eine kompakte Kalenderansicht im Stil des ursprünglichen [bahn.guru](https://github.com/juliuste/bahn.guru), erreichbar unter `/klassik`.
- **Urlaubsfinder:** Sucht ab einem Startbahnhof parallel nach günstigen Zielen – optional mit Rückfahrt – und stellt die Treffer als Liste und auf einer Karte dar.
- **Direktverbindungen:** Zeigt ohne Umstieg erreichbare Ziele auf Basis der freien GTFS.de-Daten. Die Ergebnisse lassen sich nach Verkehrsmittel, Fahrtdauer und Anzahl täglicher Verbindungen filtern.

Suchergebnisse und Fortschritt werden laufend angezeigt. Suchen können abgebrochen werden; vorzeitig beendete Ergebnisse werden als unvollständig gekennzeichnet.

## Lokal starten

Vorausgesetzt werden Node.js `>= 22.19.0` und pnpm `11.20.0`.

```bash
git clone https://github.com/sparpreis-guru/sparpreis.guru.git
cd sparpreis.guru
pnpm install
pnpm dev
```

Die App ist anschließend unter [http://localhost:3000](http://localhost:3000) erreichbar.

Für einen Produktionsstart:

```bash
pnpm build
pnpm start
```

## Docker

```bash
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_BASE_URL="http://localhost:3000" \
  -v path/to/local/data:/app/data \
  ghcr.io/sparpreis-guru/sparpreis-guru:latest
```

Das Volume unter `/app/data` bewahrt Cache, Preisverlauf und heruntergeladene Direktverbindungsdaten über Neustarts hinweg. Notwendige Datenbankanpassungen laufen beim Start automatisch.

Aufbau und Wartung der SQLite-Datenbank sind unter [Datenbank und Wartung](docs/database-maintenance.md) dokumentiert.

Das Docker-Image wird zusätzlich als `butti/sparpreis-guru:latest` auf Docker Hub gespiegelt.

Die Direktverbindungsdaten werden beim ersten Aufruf automatisch geladen und danach regelmäßig aktualisiert. Für einen manuellen Neuaufbau aus den GTFS.de-Feeds wird Python 3 benötigt:

```bash
pnpm build:direct-connections
```

## Konfiguration

| Variable | Standard | Beschreibung |
| --- | --- | --- |
| `NEXT_PUBLIC_BASE_URL` | – | Öffentliche URL der Installation |
| `ENABLE_URLAUBSFINDER` | `true` | Blendet mit `false` den Urlaubsfinder aus und deaktiviert seine API |
| `SHOW_FOOTER` | `false` | Zeigt mit `true`, `1` oder `yes` den Demo- und Kontakt-Footer |
| `DATABASE_PATH` | `data/connection-cache.db` | Abweichender Pfad für Cache und Preisverlauf |
| `CLEANUP_PAST_CONNECTIONS` | `true` | Entfernt regelmäßig abgelaufene Verbindungen aus dem Cache |
| `METRICS_API_KEY` | – | Aktiviert und schützt den Metrics-Endpunkt per Bearer-Token |
| `ALLOWED_METRICS_IPS` | – | Erlaubte IP-Adressen oder CIDR-Netze, durch Kommas getrennt |
| `LOG_LEVEL` | – | Aktiviert mit `debug` zusätzliche strukturierte Logs |

## Monitoring

Prometheus-Metriken stehen unter `/api/metrics` bereit. In Produktion müssen dafür `METRICS_API_KEY` und `ALLOWED_METRICS_IPS` gesetzt sein; der Zugriff erfordert sowohl einen gültigen Bearer-Token als auch eine freigegebene IP-Adresse.

## Technischer Überblick

- Next.js 16, React 19 und TypeScript
- Tailwind CSS und shadcn/ui
- Server-Sent Events für Suchergebnisse und Fortschritt
- SQLite für Cache und Preisverlauf
- Leaflet für Karten und Recharts für Preisverläufe

## Credits

Basiert auf [bahn.vibe](https://gitlab.com/jschae23/bahn.vibe), ursprünglich inspiriert von einer PHP-Version von hackgrid. Der Klassikmodus greift die Darstellung von [bahn.guru](https://github.com/juliuste/bahn.guru) auf.
