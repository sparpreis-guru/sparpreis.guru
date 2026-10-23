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
eine ältere Node-Runtime wurde dabei nicht getestet.

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

## Quellen

- [Vergleich von TLS-Gruppen auf Windows und Linux im BetterBahn-Projekt](https://github.com/Hamido212/betterbahn/blob/05abb116f0f53cda43c48c4d7d55754749ab5fa2/docs/bahn-api-transport.md)
- [Diskussion zu OPS_BLOCKED und TLS im db-vendo-client](https://github.com/public-transport/db-vendo-client/issues/46#issuecomment-5833995895)
- [Node.js TLS-Kontextoptionen](https://nodejs.org/api/tls.html#tlscreatesecurecontextoptions)
