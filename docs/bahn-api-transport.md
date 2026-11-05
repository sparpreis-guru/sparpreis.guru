# Bahn-API: OPS_BLOCKED und TLS

Am 23.10.2026 ließ sich `403 OPS_BLOCKED` bei der Tagesbestpreissuche mit
Node 24.18.0 / OpenSSL 3.5.7 unter Windows reproduzieren. Die blockierten
Antworten kamen mit `Server: AkamaiGHost`. Der Fehlercode allein nennt weder
die konkrete Sperrregel noch deren Ursache.

## Kontrollierter Vergleich

Für eine feste Testverbindung wurden derselbe serialisierte POST-Body und
dieselben HTTP-Header an dieselbe einmalig aufgelöste IPv4-Adresse gesendet.
Jede Variante verwendete eine neue Verbindung, HTTP/1.1 und die normale
Zertifikatsprüfung. Zwischen Abfragen lagen mindestens 1,5 Sekunden.

| TLS-Einstellung | Ergebnis |
| --- | --- |
| Bisheriger Client: maximal TLS 1.2, Standardgruppen | 403 OPS_BLOCKED |
| TLS-Standard von Node, Standardgruppen | 403 OPS_BLOCKED |
| Explizite Gruppen `X25519MLKEM768:X25519:P-256:P-384` | 201, JSON mit Bestpreisintervallen |
| Zurück auf TLS-Standard von Node | 403 OPS_BLOCKED |

Ein separater Vergleich mit der bisherigen TLS-Konfiguration ergab mit und
ohne `Accept-Language` jeweils 403. Beide expliziten Gruppenlisten (mit und
ohne `X25519MLKEM768`) lieferten anschließend auch mit den bisherigen
HTTP-Headern ohne `Accept-Language` erfolgreich Bestpreisintervalle.

Das isoliert die TLS-Konfiguration als entscheidenden Faktor in dieser
Umgebung. Es belegt keine reine IP-Sperre, keine konkrete JA3-/JA4-Regel und
keine dauerhafte Freigabe. Der Beginn der beobachteten Störung und die
internen Akamai-Regeln lassen sich daraus nicht bestimmen. Das öffentliche
Deployment muss nach Übernahme der Änderung separat geprüft werden.

## Gemeinsamer Client

`app/api/search-prices/bahn-http.ts` verwendet explizite TLS-Gruppen statt der
alten Begrenzung auf TLS 1.2. Seit der erneuten Blockierung am 05.11.2026
verwenden alle unterstützten Runtimes die klassische Liste
`X25519:P-256:P-384`. Die zuvor auf OpenSSL 3.5+ verwendete hybride Liste
`X25519MLKEM768:X25519:P-384:P-256` wird nicht mehr angeboten. TLS 1.3 bleibt
möglich; TLS-Versionen, Cipher-Suites und Zertifikatsprüfung bleiben
unverändert. Der hybride Postquanten-Schlüsselaustausch entfällt bei diesem
auf Bahn-Abfragen begrenzten Client. Eine ältere Node-Runtime wurde dabei
nicht live getestet. Die früheren Konfigurationen und Vergleichsergebnisse
sind unten als Verlauf dokumentiert.

Die Konfiguration gilt nur für den auf `https://www.bahn.de` beschränkten
Client, den Bahnhofssuche, Tagesbestpreis, Fahrplan und Rekonstruktion gemeinsam
verwenden. Rate-Limits, Wiederholungsregeln, Cache und Datenbankformat werden
dadurch nicht verändert. Eine neue Blockierung darf nicht durch unbeschränkte
Wiederholungen beantwortet werden.

Die nach der Korrektur vom 23.10.2026 direkt importierte `fetchBahn`-Funktion wurde
mit allen vier verwendeten Endpunkten geprüft: `tagesbestpreis` lieferte
201 mit sechs Intervallen, `orte` 200 mit drei Bahnhofstreffern, `fahrplan`
201 mit fünf Verbindungen und `recon` 201 mit der rekonstruierten Verbindung.
Diese Live-Prüfung erfolgte lokal unter der oben genannten Windows-Runtime.

## Erneute Blockierung am 02.11.2026

Unter Windows mit Node 24.18.0 / OpenSSL 3.5.7 und Undici 8.12.3 wurde auch
die bisher explizit konfigurierte hybride Gruppenliste blockiert. Mit einem
identischen POST-Body und identischen HTTP-Headern wurde pro Vergleich eine
einmalig aufgelöste IPv4-Adresse festgehalten. Jede Abfrage nutzte eine neue
Verbindung, HTTP/1.1 und normale Zertifikatsprüfung; zwischen den Abfragen
lagen mindestens zwei Sekunden. Es handelte sich um sieben gezielte
Vergleichsabfragen, keinen Lasttest.

| Einstellung | Erster Vergleich | Zweiter Vergleich |
| --- | --- | --- |
| Bisherige Gruppen `X25519MLKEM768:X25519:P-256:P-384` | 403 OPS_BLOCKED | — |
| Klassische Gruppen `X25519:P-256:P-384` | 201 | — |
| Bisherige Gruppen, veränderte Cipher-Suite-Reihenfolge | 201 | 201 |
| Hybride Gruppen `X25519MLKEM768:X25519:P-384:P-256` | — | 201 |
| Rückwechsel auf bisherige Gruppen und Standard-Ciphers | 403 OPS_BLOCKED | 403 OPS_BLOCKED |

Die beiden Vergleiche verwendeten unterschiedliche Akamai-IPv4-Adressen;
innerhalb jedes Vergleichs blieb die Adresse gleich. Die Cipher-Varianten
waren unterschiedlich: zuerst eine explizite Liste moderner Suites, danach
nur eine Umordnung der drei TLS-1.3-Suites bei unveränderten übrigen
Node-Standard-Ciphers.

Die Korrektur tauscht ausschließlich die letzten beiden Gruppen der hybriden
Liste. Alle angebotenen Gruppen, die bevorzugte hybride Gruppe, Ciphers,
HTTP-Header und HTTP-Version bleiben erhalten. Die klassische Liste für
ältere OpenSSL-Versionen bleibt unverändert. Es gibt keine automatische
Rotation oder zusätzliche Wiederholung blockierter Anfragen.

Dieses Ergebnis belegt erneut einen Einfluss des TLS-ClientHello in der
getesteten Umgebung. Eine reine IP-Sperre erklärt den kontrollierten
Wechsel zwischen erfolgreichen und blockierten Antworten nicht. Weder eine
konkrete interne Sperrregel noch eine dauerhafte Freigabe sind damit belegt.
Ein Undici-Downgrade ist durch diese Ergebnisse nicht begründet. Die
Produktionsumgebung muss separat geprüft werden.

Nach der Änderung wurde die tatsächliche `fetchBahn`-Funktion erneut direkt
importiert und mit vier echten Abfragen geprüft: `tagesbestpreis` lieferte
201 mit sechs Intervallen, `orte` 200 mit drei Treffern, `fahrplan` 201 mit
fünf Verbindungen und `recon` 201 mit einer rekonstruierten Verbindung.
Diese Prüfung erfolgte lokal unter Windows mit der oben genannten Runtime;
ein Linux-/Container- oder Deployment-Test wurde dabei nicht durchgeführt.

## Klassische Gruppen nach erneuter Blockierung am 05.11.2026

Ein kontrollierter lokaler Vergleich unter Windows mit Node 24.18.0,
OpenSSL 3.5.7 und Undici 8.12.3 bestätigte die erneute Blockierung der
hybriden Liste aus Version 2.4.3. Der Vergleich importierte den gemeinsamen
Client mit zwei isolierten Agent-Instanzen. Nur die Gruppenliste wurde für
die klassische Variante geändert. Beide Varianten verwendeten dieselbe
einmalig aufgelöste Akamai-IPv4-Adresse `95.100.110.26`, identische Header und
für den Preisvergleich denselben serialisierten POST-Body. Die IPv4-Adresse
war ausschließlich im Test festgehalten und wird nicht im Runtime-Client
hinterlegt. Die insgesamt neun Anfragen wurden im Abstand von mindestens
drei Sekunden gestartet; Bestätigungs- und Kontrollabfragen sind darin
enthalten.

Geprüft wurde Berlin Hbf nach München Hbf am 19.11.2026, zweite Klasse,
ein Erwachsener ohne BahnCard. Erfolg erforderte passende API-JSON-Inhalte,
nicht nur einen HTTP-2xx-Status.

| Abfrage | Hybride Liste aus v2.4.3 | Klassische Liste `X25519:P-256:P-384` |
| --- | --- | --- |
| Bahnhofssuche Berlin | 403 OPS_BLOCKED, vor und nach dem Vergleich | 200, Bahnhofstreffer |
| Bahnhofssuche München | nicht separat geprüft | 200, Bahnhofstreffer |
| Tagesbestpreis | 403 OPS_BLOCKED | 201, sechs bepreiste Intervalle; Wiederholung ebenfalls 201 |
| Fahrplan | nicht separat geprüft | 201, fünf Verbindungen |
| Rekonstruktion | nicht separat geprüft | 201, eine rekonstruierte Verbindung mit zwölf Angeboten |

Daraufhin wurde die klassische Liste als einzige Gruppenliste in den
gemeinsamen Client übernommen. Der bisherige versionsabhängige Zweig
entfällt. HTTP/1.1, IPv4, Cipher-Suites, TLS-Versionsgrenzen, Zertifikatsprüfung,
Rate-Limits, Cache und Wiederholungsregeln bleiben unverändert. Es wird keine
automatische Rotation zwischen TLS-Profilen ergänzt.

Die anschließend erneut direkt importierte tatsächliche `fetchBahn`-Funktion
wurde mit normaler DNS-Auflösung und fünf weiteren Anfragen auf allen vier
Endpunkten erfolgreich geprüft: Bahnhofssuche Berlin und München jeweils
200 mit Bahnhofstreffern, Tagesbestpreis 201 mit sechs bepreisten Intervallen,
Fahrplan 201 mit fünf Verbindungen und Rekonstruktion 201 mit einer
Verbindung und zwölf Angeboten. Die Testinstrumentierung ergänzte nur eine
Möglichkeit zum Schließen des Agenten nach dem Test; die Runtime-Konfiguration
blieb unverändert.
Der kontrollierte Vergleich belegt einen Einfluss der geänderten
TLS-Konfiguration in dieser lokalen Umgebung, keine konkrete Akamai-Regel
und keine dauerhafte Freigabe. Linux-/Container- und Deployment-Zugriffe
müssen separat geprüft werden. Die konfigurierbare Deployment-Sperre
`DISABLE_PRICE_SEARCH` wird durch diese Transportänderung nicht aufgehoben.

## Quellen

- [Vergleich von TLS-Gruppen auf Windows und Linux im BetterBahn-Projekt](https://github.com/Hamido212/betterbahn/blob/05abb116f0f53cda43c48c4d7d55754749ab5fa2/docs/bahn-api-transport.md)
- [Diskussion zu OPS_BLOCKED und TLS im db-vendo-client](https://github.com/public-transport/db-vendo-client/issues/46#issuecomment-5833995895)
- [Node.js TLS-Kontextoptionen](https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions)
