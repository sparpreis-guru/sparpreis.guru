# Turnstile-Schutz für Suchanfragen

Cloudflare Turnstile lässt sich optional vor die Preis- und Bahnhofssuche schalten. Ohne
Aktivierung bleibt das bisherige Verhalten erhalten; es wird kein
Turnstile-Skript geladen und keine Siteverify-Anfrage ausgeführt.

## Aktivieren

Im Cloudflare-Dashboard ein Turnstile-Widget im Modus **Managed** erstellen
und die Hostnamen der Installation freigeben. Anschließend setzen:

```dotenv
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=<öffentlicher Site-Key>
TURNSTILE_SECRET_KEY=<geheimer Secret-Key>
TURNSTILE_HOSTNAMES=sparpreis.guru,www.sparpreis.guru
TURNSTILE_APPEARANCE=interaction-only
```

`TURNSTILE_HOSTNAMES` enthält die exakten erlaubten Widget-Hostnamen ohne
Protokoll, Pfad oder Port. Eigene Installationen tragen ihre eigenen
Hostnamen ein. Die Anwendung vergleicht den von Cloudflare bestätigten
Hostnamen mit dieser Liste; Request-Header wie `Host` oder `X-Forwarded-Host`
dienen nicht als Freigabe.

Danach die Anwendung beziehungsweise den Container neu starten. Alle
Einstellungen werden zur Laufzeit gelesen; zum Ändern der Schlüssel oder
zum Aktivieren des Schutzes muss ein bereits mit dieser Unterstützung
gebautes Docker-Image nicht neu gebaut werden. Der Secret-Key wird nie
an den Browser übergeben. Kein Schlüssel gehört in Such-URLs oder Logs.

Mit `TURNSTILE_ENABLED=false` wird der Schutz wieder deaktiviert. Es gibt
keinen automatischen Bypass für localhost oder bestimmte IP-Adressen.
Bei aktivierter, aber unvollständiger Konfiguration bleiben die Preis-APIs
gesperrt und antworten mit HTTP 503; dasselbe gilt für geschützte Stationsabrufe.

## Ablauf und Umfang

Unmögliche Kalenderdaten und Zeitfenster mit mehr als 366 Kalendertagen
werden vor der Datumsermittlung abgewiesen. Diese technische Obergrenze
liegt oberhalb jedes zulässigen Fensters mit höchstens 30 ausgewählten
Reisetagen, auch wenn nur ein Wochentag gewählt ist. So können manipulierte
Direktlinks keine millionenlangen Datumslisten und paarweisen Vergleiche
auslösen. Im Klassikmodus richten sich die Datumsgrenzen ebenfalls nach
den gemeinsamen Helfern für `Europe/Berlin`.

- Direktlinks befüllen nur das Formular. Bestpreissuche, Klassikmodus und
  Urlaubsfinder starten erst nach einem ausdrücklichen Klick auf Suchen.
  Auch ein Neuladen oder die Browser-Zurücknavigation startet keine Preisabfrage.
- Vor einem Suchstart läuft die Managed-Prüfung. Bei Bedarf zeigt das Widget
  eine Interaktion an. Die automatische Prüfung ist die erste Phase der
  vorhandenen Fortschrittsanzeige mit deren Abbruchaktion und Scrollziel.
  Währenddessen werden weder Suchprozent noch Restzeit angezeigt und die
  Fortschritts-API wird nicht abgefragt. Anschließend zeigt dasselbe Modul
  direkt den Suchfortschritt. Im Klassikmodus ersetzt die Prüfung den Text
  in der vorhandenen Statuszeile, ohne eine zusätzliche Zeile einzufügen.
  Erst wenn
  Cloudflare über `before-interactive-callback` eine Eingabe anfordert,
  öffnet sich das Widget als modaler Dialog. Dabei bleibt dasselbe Widget
  eingebunden; die Prüfung wird beim Öffnen und Schließen nicht neu gestartet.
  Eingaben bleiben erhalten. Fehler erscheinen als Hinweis an den Ergebnissen.
- Der Browser sendet das frische Token als `X-Turnstile-Token` direkt mit
  dem jeweiligen POST. Der Server validiert es über Cloudflares Siteverify
  und prüft `success`, Hostname und die zum Endpunkt gehörende `action`.
- Erst danach werden Suchparameter verarbeitet, Bahnhöfe aufgelöst,
  Cache-Ergebnisse gelesen oder Bahn-Abfragen in die Queue aufgenommen.
- Ein Cloudflare-Token wird genau einmal validiert. Eine mehrtägige Suche
  oder Hin-/Rückfahrtsuche darf danach alle zugehörigen internen
  Bahn-Abfragen ausführen. Der laufende Stream benötigt keine weiteren Tokens.
- Nach einer frisch verifizierten Bestpreissuche erhält der Browser eine
  zufällige Freigabe für Kalender-Nachladeanfragen derselben Suche. Die
  Preis-APIs prüfen diese Freigabe serverseitig bei jeder Folgeanfrage.
  Zusätzliche Tage, Kombinationen und Flexpreise erfordern innerhalb der
  Freigabe kein weiteres Turnstile-Popup.
- Neue Suchen, ein Wechsel des Vergleichsreisewegs und Urlaubsfinder-Suchen
  benötigen weiterhin ein frisches Cloudflare-Token. Fehlt eine
  Nachladefreigabe oder ist sie abgelaufen beziehungsweise ausgeschöpft,
  fordert der Browser einmal eine neue Prüfung an. Gleichzeitig
  angeforderte Prüfungen werden nacheinander ausgeführt.

## Bahnhofssuche: 30 Minuten und 100 Autocomplete-Anfragen

Bei `TURNSTILE_ENABLED=true` schützt der Server auch `GET /api/station-search`
und die Auswahlstatistik über `POST /api/station-search`. Beim ersten
Stationsabruf ohne gültige Freigabe fordert der Browser still eine Prüfung
mit `action: station-search` an. Das Token wird einmalig über
`POST /api/station-search/verify` mit Siteverify validiert. Eine zufällige
Freigabekennung erlaubt danach maximal **100 Autocomplete-Anfragen innerhalb
von 30 Minuten**. Beide Grenzen gelten gleichzeitig; weitere Nutzung
verlängert die Laufzeit nicht. Cache-Treffer, die Auflösung von Stations-IDs
und fehlgeschlagene Abrufe zählen ebenfalls. Suchbegriffe unter zwei Zeichen
liefern ohne Freigabe nur eine leere Antwort und lösen keine Bahn-Anfrage aus;
mehr als 200 Zeichen werden abgewiesen.

Jede Anfrage reserviert vor Cache-Zugriff oder Bahn-Abfrage synchron eine
Einheit. Gleichzeitige Anfragen können das Budget deshalb nicht überschreiten.
Auswahlstatistiken benötigen dieselbe gültige Freigabe und haben zusätzlich
ein separates Budget von 100 Klickmeldungen, damit eine Auswahl nach dem
100. Autocomplete-Abruf noch erfasst werden kann. Klickmeldungen lösen keine
Bahn-Abfragen aus und verlängern die Freigabe nicht.

Das Stations-Widget ist unabhängig von der Preis-Fortschrittsanzeige im
gemeinsamen Provider eingebunden. Es verwendet immer `interaction-only`,
auch bei anderer Einstellung von `TURNSTILE_APPEARANCE`. Automatische
Prüfungen erzeugen keine sichtbare Statuszeile und verschieben das Formular
nicht. Erst bei angeforderter Interaktion öffnet dasselbe Widget den
gemeinsamen Dialog mit Hinweis auf die Bahnhofssuche. Technische Fehler
erscheinen am jeweiligen Bahnhofsfeld. Gleichzeitige Abrufe teilen eine
laufende Prüfung. Überholte Anfragen desselben Felds werden abgebrochen;
sie dürfen nach der Prüfung keine veralteten Vorschläge einblenden.

Nach Ablauf oder ausgeschöpftem Budget ist eine neue Prüfung erforderlich.
Der Client erneuert eine abgewiesene Freigabe höchstens einmal pro Abruf;
Lade- oder Validierungsfehler erzeugen keine automatische Prüfschleife.
Stations-IDs aus Direktlinks werden ebenfalls geschützt aufgelöst: Dabei
kann schon vor dem ausdrücklichen Preis-Suchstart eine Stationsprüfung
notwendig sein. Die ursprünglichen IDs bleiben bei Fehlern erhalten.
Die gesperrte, nicht bedienbare Preis-Suchseite startet keine solchen Abrufe.

Die Kennung wird nur im Arbeitsspeicher der geöffneten Seite gehalten und
als `X-Station-Search-Grant` bei Autocomplete und Auswahlstatistik übertragen.
Sie wird weder in Cookies noch Local Storage, Session Storage oder URLs
geschrieben. Der Server hält
nur Hashes der zufälligen Kennungen, Ablaufzeiten und Restbudgets im
Arbeitsspeicher; maximal 2048 Freigaben pro Node-Prozess. Abgelaufene
Einträge werden beim Zugriff oder Ausstellen weiterer Freigaben entfernt.
Neustart oder Wechsel der Instanz erfordern eine neue Prüfung. Bei voller
Kapazität wird keine Freigabe ausgestellt. Weder Stationsfreigabe noch Stationsprüfung
erlauben Preisabfragen; Preis-Tokens und Kalenderfreigaben werden umgekehrt
nicht als Stationsfreigabe akzeptiert. Unvollständige Konfiguration bleibt
auch mit vorhandener Kennung gesperrt. Keine Freigabe wird in der
Cache-Datenbank gespeichert. Die globalen Stations-Rate-Limits bleiben aktiv.

## Begrenzte Nachladefreigabe für Preisabfragen

Die Freigabe gilt höchstens 20 Minuten ab Ausstellung. Nachladen verlängert
weder Laufzeit noch Datumsbereich. Die Berechtigung ist an Strecke,
Tarifparameter, Reisende und Zeit-/Umstiegsfilter gebunden. Die zufällige
Freigabekennung bleibt im Arbeitsspeicher der Suchseite. Andere Strecken oder Tarife werden abgewiesen.
Eine erneute Turnstile-Prüfung kann anschließend die neue Anfrage freigeben.

Bei einfachen Fahrten reicht das feste Datumfenster vom ursprünglichen
Beginn minus 14 Tage bis zum ursprünglichen Ende plus 14 Tage. Bei
Hin-/Rückfahrten bleibt es beim ursprünglichen Suchzeitraum. Wochentage
dürfen sich für einen explizit angeklickten Zusatztag ändern. Reguläre
Datumsgrenzen und Suchvalidierungen gelten weiterhin. Eine Freigabe
berechtigt nur zu ausdrücklich ausgewählten Tagen oder Flexpreis-Details,
nicht zu einem beliebigen neuen vollständigen Suchlauf.

Pro Freigabe stehen 64 zusätzliche Arbeitseinheiten zur Verfügung:
Ein Bestpreistag zählt eine Einheit, ein Hinreisetag mit Flexpreisvergleich
zwei und eine zusätzliche Flexpreis-Tagesprüfung sieben. Letztere kann
weitere Angebotsabfragen auslösen. Das Budget wird vor weiterer Verarbeitung
synchron reserviert; parallele Aufrufe und Wiederholungen können es nicht
mehrfach verwenden. Abgebrochene oder fehlgeschlagene Anfragen erhalten
die reservierten Einheiten nicht zurück. Die vorhandenen globalen
Rate-Limits begrenzen weiterhin die tatsächlichen Bahn-Abfragen.

Die Freigabezuordnungen werden ausschließlich im Speicher
des jeweiligen Node-Prozesses gehalten. Gespeichert werden Hashes der
zufälligen Kennungen, ein Hash der gebundenen Suchparameter, Grenzen und
Restbudget. Es gibt maximal 2048 gleichzeitig gespeicherte Freigaben;
abgelaufene Einträge werden beim Zugriff beziehungsweise beim Ausstellen
weiterer Freigaben entfernt. Bei voller Kapazität bleibt die frisch
verifizierte Suche möglich, es wird aber keine Nachladefreigabe ausgestellt.
Nach Neustart oder Wechsel auf eine andere Instanz ist eine neue Prüfung
nötig. Mehrere Replikas benötigen für eine durchgehend geteilte Freigabe
einen gemeinsamen Speicher oder eine feste Zuordnung zur Instanz. Ein
fehlender Eintrag führt immer zur erneuten Prüfung.

Die Freigabekennung
wird nur im Arbeitsspeicher der Suchseite gehalten und als
`X-Price-Search-Grant` übertragen, nicht in Such-URLs, Cookies, Local Storage
oder Session Storage. Wer eine gültige Kennung besitzt, kann sie innerhalb
ihres serverseitig begrenzten Umfangs verwenden; sie ist daher wie eine
Berechtigung zu behandeln und darf nicht geteilt oder protokolliert werden.
Cloudflare-Tokens werden dafür nicht wiederverwendet. Es gibt keinen
allgemeinen, zeitweisen Turnstile-Bypass für beliebige Suchen.

## Sichtbarkeit und manuelle Bestätigung

`TURNSTILE_APPEARANCE=interaction-only` zeigt Cloudflares Widget nur bei
benötigter Interaktion. Mit `always` ist es während jeder tatsächlichen
Prüfung auf der Seite sichtbar; `execute` zeigt es ab Ausführung der Prüfung.
Beide Einstellungen öffnen das Popup ebenfalls nur bei benötigter Eingabe. Diese
Einstellung betrifft die Sichtbarkeit und setzt keinen Schwierigkeitsgrad.
Den Widget-Modus (Managed, Non-Interactive oder Invisible) verwaltet
Cloudflare im Dashboard. Im Managed-Modus entscheidet Cloudflare, ob eine
Checkbox nötig ist. Ein produktiver Modus, der bei jedem Besucher zwingend
einen Klick verlangt, wird von Turnstile nicht angeboten. Die offiziellen
Schlüssel für erzwungene Interaktion sind ausschließlich für Tests gedacht.

| Preis-API | Erwartete Aktion |
| --- | --- |
| `/api/search-prices` einschließlich Klassikmodus | `bestpreissuche` |
| `/api/urlaubsfinder` | `urlaubsfinder` |
| `/api/flexpreis/day` | `flexpreis` |
| `/api/station-search/verify` | `station-search` |

Fehlende, ungültige, abgelaufene oder wiederverwendete Tokens werden vor
jeder Suchverarbeitung mit HTTP 403 abgewiesen. Siteverify-Ausfälle,
Timeouts und Konfigurationsfehler liefern HTTP 503; es werden dabei keine
Preisabfragen freigegeben. Die Oberfläche unterscheidet diese Fehler von
Blockierungen der Bahn-API.

`DISABLE_PRICE_SEARCH=true` hat Vorrang: Es erscheint weiterhin der
Sperrhinweis und es wird keine Turnstile-Prüfung für eine Preisabfrage
gestartet. `ENABLE_URLAUBSFINDER=false` blendet den Urlaubsfinder weiterhin
vollständig aus.

Direktverbindungen, Fortschrittsabfragen und Abbruch
benötigen kein Turnstile-Token. Die bestehenden globalen Bahn-Rate-Limits
gelten unverändert. Turnstile ergänzt diese Limits und ist keine Garantie,
dass jeder automatisierte oder missbräuchliche Zugriff erkannt wird.

## Proxy und Datenschutz

Die Prüfung funktioniert unabhängig von Cloudflare-Proxy oder Tunnel.
Der optionale Siteverify-Parameter `remoteip` wird nicht gesendet; die
Anwendung vertraut hierfür keinen vom Aufrufer setzbaren IP-Headern.
Für zusätzliche Limits pro Besucher müssten Proxy-Vertrauen und
Besucheridentifikation separat konfiguriert werden. Vor Siteverify sollten
bei Bedarf auch am Reverse Proxy Limits gegen übermäßige Validierungsanfragen
gelten.

Das Skript wird bei der ersten angeforderten Prüfung direkt von
`challenges.cloudflare.com` geladen. Der vor dem Einfügen registrierte
`onload`-Callback der Turnstile-API gibt das Rendern frei; es gibt keinen
nachträglichen `turnstile.ready()`-Aufruf im Script-Ladeereignis. Parallele
Prüfungen teilen denselben Ladevorgang. Bei Ladefehlern oder einem Timeout
nach 15 Sekunden kann der nächste Suchstart das Skript neu laden.
Eine vorhandene Content Security Policy
muss die laut Cloudflare erforderlichen Skript- und Frame-Quellen erlauben.
Widget und Projekt-Footer informieren bei aktivierter Funktion über
Cloudflare Turnstile und verlinken die Datenschutzerklärung. Tokens und
Secrets werden nicht gespeichert oder protokolliert. Die Cache-Datenbank
und ihre Wartungsregeln ändern sich nicht.

Die Anwendung setzt für diese Freigaben keine Cookies. Die Kennungen
existieren nur in JavaScript-Variablen der aktuellen Seiteninstanz. **F5,
vollständiges Neuladen und Schließen der Seite löschen die Freigabe im
Browser.** Ein neuer Tab oder eine neu geladene Seite kann die Kennung nicht
aus einem Browserspeicher wiederherstellen. Beim nächsten geschützten Abruf
ist eine neue Turnstile-Prüfung nötig; während einer geöffneten Seite teilen
gleichzeitige Stationsabrufe weiterhin eine einzige Prüfung. Häufiges
Neuladen verursacht deshalb zusätzliche Prüfungen. Es gibt kein verdecktes
Fortbestehen über Cookies, Session Storage oder Local Storage.

Serverseitige Einträge können nach dem Schließen noch bis zum festen Ablauf
existieren, sind ohne die verlorene zufällige Kennung aber nicht abrufbar.
Der Projekt-Footer nennt den Sicherheitszweck und die Übermittlung
technischer Daten an Cloudflare. Cloudflare beschreibt unter anderem
IP-Adresse, TLS-Fingerprint und Browser-Header im
[Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).

Der Wegfall eigener Cookies garantiert keine Einwilligungsfreiheit für den
gesamten Turnstile-Einsatz oder andere Speichertechniken.
Der Betreiber muss den konkreten Einsatz einschließlich Laufzeit, Umfang
und Turnstile-Verarbeitung bewerten und die erforderlichen
Datenschutzinformationen und die passende Rechtsgrundlage bereitstellen.
Der technische Kurztext im Footer ersetzt diese Bewertung und eine
vollständige Datenschutzerklärung nicht. Ein Einwilligungsbanner wird durch
dieses Feature nicht automatisch ergänzt.

## Prüfen

Die automatisierten Tests ersetzen Siteverify durch kontrollierte Antworten
und prüfen unter anderem fehlende Tokens, Replay, falsche Aktionen und
Hostnamen, Cloudflare-Ausfälle sowie das Unterbinden jeder Suchverarbeitung
bei einer abgewiesenen Prüfung. Sie verwenden eine isolierte In-Memory-
Datenbank und führen keine echten Bahn-Abfragen aus.

Für einen vollständigen manuellen Browser-Test unter localhost ein separates
Managed-Entwicklungs-Widget mit echten Schlüsseln anlegen. Im Cloudflare-
Dashboard `localhost` und bei Bedarf `127.0.0.1` als Hostnamen freigeben und
in der lokalen Serverumgebung konfigurieren:

```dotenv
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=<Site-Key des Entwicklungs-Widgets>
TURNSTILE_SECRET_KEY=<Secret-Key des Entwicklungs-Widgets>
TURNSTILE_HOSTNAMES=localhost,127.0.0.1
```

Danach den Dev-Server neu starten. Die Hostnamen werden ohne Port angegeben;
`http://localhost:3000` benötigt also den Eintrag `localhost`. Die Entwicklung
verwendet dieselbe Hostnamen- und Aktionsprüfung wie das öffentliche
Deployment. Cloudflare empfiehlt, lokale Hostnamen nicht im Produktions-
Widget freizugeben.

Die lokale Freigabe kann gezielt in `.env.development.local` stehen:

```dotenv
TURNSTILE_HOSTNAMES=localhost,127.0.0.1
```

Next.js lädt diese Datei bei `dev` vor `.env.local` und `.env`; der
Produktionsbetrieb liest sie nicht. Site-Key und Secret-Key können dabei
weiterhin in der bestehenden `.env.local` bleiben. Die Datei ist wie alle
`.env*`-Dateien von Git ausgeschlossen.

Bei einem Hostnamen-Fehler nennt das Serverlog jetzt die freigegebenen
Hostnamen und den von Cloudflare bestätigten Hostnamen. Eine abweichende
Aktion wird separat mit erwarteter und empfangener Aktion protokolliert.
Tokens und Secrets erscheinen nicht in diesen Diagnosen.

### Interaktions-Popup gezielt testen

Cloudflare bietet einen öffentlichen Test-Site-Key an, der immer eine
Interaktion verlangt. Für einen reinen Oberflächentest in
`.env.development.local` vorübergehend ergänzen:

```dotenv
TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=3x00000000000000000000FF
TURNSTILE_APPEARANCE=interaction-only
```

Den Dev-Server neu starten, die Seite vollständig neu laden und auf Suchen
klicken. Der echte Turnstile-Testdialog muss sich über denselben
`before-interactive-callback` öffnen wie bei einem regulären Besucher.
Damit lassen sich Darstellung, Checkbox, Schließen und Abbruch im
Bestpreiskalender, bei Hin-/Rückfahrt, im Urlaubsfinder und im Klassikmodus
prüfen. Der Test-Key funktioniert auch auf localhost.

Dies ist ein Test der Oberfläche: Nach der Bestätigung wird das Dummy-Token
vom produktiven Secret-Key abgewiesen. Auch mit Cloudflares öffentlichem
Test-Secret-Key kann unsere strikte Aktionsprüfung die Dummy-Antwort mit
`action: test` abweisen. Es ist deshalb zu erwarten, dass anschließend ein
Prüfungsfehler erscheint und keine Preisabfrage startet. Für erfolgreiche
echte Suchen die vorübergehenden Test-Einträge wieder entfernen, damit
die vorhandenen echten Schlüssel gelten, und den Dev-Server neu starten.
Es wird kein Bypass für Dummy-Tokens eingeführt.

Die offiziellen Dummy-Testschlüssel testen Cloudflares Widget- und
Validierungszustände. Sie ersetzen den vollständigen Integrationstest mit
echten Entwicklungs-Schlüsseln nicht: Cloudflare dokumentiert eine
Dummy-Antwort mit der Aktion `test`, während unsere Preis-APIs die jeweilige
Aktion `bestpreissuche`, `urlaubsfinder` oder `flexpreis` verlangen. Es gibt
keinen Sonderfall, der diese Prüfung für Dummy-Tokens umgeht.

Vor Aktivierung im öffentlichen Deployment mit den passenden echten
Schlüsseln prüfen, ob die freigegebenen Hostnamen stimmen, die Challenge
abgeschlossen werden kann und eine echte Suche erfolgreich startet.
Browser-Tests werden nicht automatisch ausgeführt.

Quellen:

- [Serverseitige Validierung und Token-Gültigkeit](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Widget-Konfiguration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)
- [Explizites Rendern mit Lade-Callback](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/#using-onload-callback)
- [Testschlüssel](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
- [Content Security Policy](https://developers.cloudflare.com/turnstile/reference/content-security-policy/)
