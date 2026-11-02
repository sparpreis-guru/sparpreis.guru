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
alten Begrenzung auf TLS 1.2. Auf OpenSSL 3.5 oder neuer bleibt hybrider
Schlüsselaustausch über `X25519MLKEM768` verfügbar. Ältere Versionen verwenden
`X25519:P-256:P-384`; die Gruppenliste wurde ebenfalls live geprüft,
eine ältere Node-Runtime wurde dabei nicht getestet. Seit der erneuten
Blockierung am 02.11.2026 verwendet OpenSSL 3.5+ die korrigierte Reihenfolge
`X25519MLKEM768:X25519:P-384:P-256` (siehe Vergleich unten).

Die Konfiguration gilt nur für den auf `https://www.bahn.de` beschränkten
Client, den Bahnhofssuche, Tagesbestpreis, Fahrplan und Rekonstruktion gemeinsam
verwenden. Rate-Limits, Wiederholungsregeln, Cache und Datenbankformat werden
dadurch nicht verändert. Eine neue Blockierung darf nicht durch unbeschränkte
Wiederholungen beantwortet werden.

Die anschließend direkt importierte korrigierte `fetchBahn`-Funktion wurde
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

## Quellen

- [Vergleich von TLS-Gruppen auf Windows und Linux im BetterBahn-Projekt](https://github.com/Hamido212/betterbahn/blob/05abb116f0f53cda43c48c4d7d55754749ab5fa2/docs/bahn-api-transport.md)
- [Diskussion zu OPS_BLOCKED und TLS im db-vendo-client](https://github.com/public-transport/db-vendo-client/issues/46#issuecomment-5833995895)
- [Node.js TLS-Kontextoptionen](https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions)
