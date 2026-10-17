# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primäre Nutzer sind preisbewusste Bahnreisende, die bei Reisetag, Reiseziel oder beidem flexibel sind. Sie möchten passende Bahnverbindungen selbst vergleichen, bevor sie eine Buchungsentscheidung treffen.

## Product Purpose

sparpreis.guru macht günstige Bahnreisen über flexible Reisetage und Reiseziele vergleichbar. Erfolg bedeutet, dass Nutzer aus vielen möglichen Tagen, Hin- und Rückfahrtkombinationen oder Zielen schnell eine passende Verbindung erkennen und anschließend beim jeweiligen Anbieter weitergehen können.

## Positioning

Das Produkt verbindet drei Arten der Reiseorientierung in einer Suchhilfe: Preisvergleiche über mehrere Reisetage für feste Strecken, Preisvergleiche über mehrere Ziele bei offenem Reiseziel sowie eine Karte der ohne Umstieg erreichbaren Bahnhöfe. Für Hin- und Rückfahrten werden zulässige Reisetagkombinationen gemeinsam ausgewertet und als Liste und Preismatrix vergleichbar gemacht.

## Operating Context

Die Anwendung wird als responsive Web-App während der Reiseplanung verwendet. Nutzer geben Bahnhöfe, Reisezeiträume und persönliche Tarifparameter ein, grenzen Ergebnisse mit Zeit-, Umstiegs- und Verbindungstypfiltern ein und verfolgen die laufende Suche. Ergebnisse enthalten Preise, Fahrzeiten, Umstiege, Fahrtverläufe und externe Buchungslinks. Suchen können abgebrochen werden; unvollständige Ergebnisse werden entsprechend gekennzeichnet.

Die Direktverbindungssuche dient der Orientierung und zeigt keine Ticketpreise. Sie verwendet vorbereitete GTFS.de-Daten statt Live-Preisabfragen.

## Capabilities and Constraints

- Die Bestpreissuche vergleicht Verbindungen an bis zu 30 ausgewählten Reisetagen und unterstützt einfache Fahrten sowie flexible Hin- und Rückfahrten.
- Der Urlaubsfinder vergleicht ausgewählte Ziele ab einem Startbahnhof, optional mit Rückfahrt, und zeigt Ergebnisse als Liste und Karte.
- Die Direktverbindungssuche zeigt ohne Umstieg erreichbare Ziele und filtert nach Verkehrsmittel, Fahrtdauer und Anzahl täglicher Verbindungen.
- Preisabfragen werden in der Regel live durchgeführt, können aber aus einem zeitlich begrenzten Cache stammen. Preise bleiben bis zur Buchung beim Anbieter unverbindlich. In schmalen Kalenderansichten sind die Tagespreise auf volle Euro gerundet. Tagesdetails, zugängliche Beschriftung und Tooltip zeigen weiterhin den centgenauen Betrag; Preisvergleich und Farbskala arbeiten mit den unveränderten Daten.
- Der optionale Flexpreisvergleich dient vor allem dem Vergleich von Reisetagen. Der Kalender verwendet einen festen beobachteten Reiseweg mit gleicher Haltefolge und Produktklasse. Automatisch wird der an den meisten Tagen gefundene Weg gewählt, bei Gleichstand die schnellere Verbindung; die Basis ist sichtbar und wechselbar. Pro passendem Tag wird eine konkrete Verbindung über `recon` geprüft. Fehlende Treffer oder Abfragefehler führen nicht zum Preis einer anderen Route. In den Tagesdetails lassen sich bis zu fünf unterschiedliche beobachtete Wege prüfen; erfolgreiche Angebote bleiben bei Teilfehlern erhalten. Zeiten, Züge, Zwischenhalte und Preis gehören immer zur tatsächlich geprüften Fahrt. Zwischenhalte sind keine tarifliche Via-Angabe; gleiche Preise werden nicht als gleiche Streckengültigkeit ausgelegt. Keine Bestpreis- oder Vollständigkeitsgarantie. Der Prüflink öffnet ausdrücklich eine Bahn-Suche, keinen zugesicherten Direktlink zum Angebot. Die erste Version beschränkt sich auf einfache Fahrten und nationale Flexpreis-Angebote. Tagesbestpreis-Ergebnisse heißen „Bestpreise“, da die Antwort den Tarifnamen nicht zuverlässig ausweist.
- Eine erfolgreiche erneute Flexpreis-Prüfung ersetzt ältere Ergebnisse, auch wenn kein Angebot mehr vorhanden ist. Bei technischen Teilfehlern bleiben nicht erfolgreich neu geprüfte Angebote mit einem Fehlerhinweis sichtbar. Fehler der Verbindungssuche gelten als technische Abfragefehler, nicht als fehlende Vergleichbarkeit. „Angaben zurücksetzen“ deaktiviert den optionalen Flexpreisvergleich.
- sparpreis.guru ist eine Such- und Vergleichshilfe und kein Ticketverkaufssystem.
- Der Flexpreis-Kalender vergleicht eine gewählte beobachtete Haltefolge und Produktklasse über die Reisetage. Der sichtbare Hinweis benennt andere tarifliche VIA-Strecken oder Produktklassen, etwa IC statt ICE, als mögliche Quelle anderer Flexpreise. Die Begrenzung auf eine Preisabfrage pro passendem Tag bedeutet nicht, dass wir unterschiedliche Flexpreise für denselben bestätigten tariflichen Weg und dieselben Tarifparameter unterstellen. Die genutzte Bahn-Schnittstelle liefert die spätere Ticket-VIA-Angabe nicht; identische beobachtete Zwischenhalte bestätigen deshalb keine identische Streckengültigkeit. Andere tarifliche Wege und Produktklassen werden nicht vollständig geprüft. „Hinweise zum Reiseweg“ erklärt Vorauswahl und begrenzte Preisabfragen.
- Die Flexpreis-Reisewegauswahl nennt die Anzahl eindeutig gefundener Verbindungen und die Zahl der Reisetage mit Treffern je genauer Haltefolge. Das sind Stichproben dieser Suche, keine Gesamtzahlen des Fahrplans. Die Vorauswahl richtet sich weiterhin nach möglichst vielen Reisetagen, nicht nach der größten Verbindungsanzahl. Verkürzte Bezeichnungen behalten unterscheidende Halte sichtbar; verschiedene Haltefolgen werden dadurch weder tariflich gleichgesetzt noch zusammengeführt. Dieselbe Auswahl mit denselben Kennzahlen ist im Flexpreis-Tagesergebnis verfügbar und gilt immer für alle Reisetage. Bei nur einem gewählten und verfügbaren Weg gibt es keine Änderungsaktion. Beim Wechsel bleiben der geöffnete Tag und die Bestpreisdaten erhalten; alte Vergleichspreise werden entfernt und auch bereits nachgeladene Tage für den neuen Weg erneut geprüft.
- Die „übliche Fahrzeit“ in der Reisewegauswahl ist der Median der gültigen Fahrtdauern eindeutig gefundener Verbindungen dieses Reisewegs. Unbekannte Dauern werden ausgelassen; ohne gültige Dauer wird kein Wert behauptet. Diese Orientierung ist von den exakten Zeiten und der Fahrtdauer der tatsächlich bepreisten Verbindung getrennt. Halte, Angebotsbedingungen und Abfragezeit bleiben in den aufklappbaren Angebotsdetails zugänglich. Die übliche Umstiegszahl ist die häufigste gültige Anzahl unter denselben eindeutig gefundenen Fahrten; bei Gleichstand wird die niedrigere Anzahl gezeigt. Null wird als „Direkt“ dargestellt, unbekannte Werte bleiben ohne Zahlenangabe. Fahrzeit und Umstiege stehen sowohl bei der gewählten Vergleichsbasis als auch in den Auswahloptionen.
- Es werden keine personenbezogenen Profile angelegt. Suchdaten dürfen technisch verarbeitet und zeitweise zwischengespeichert werden; aggregierte Bahnhofsauswahlen dürfen die Sortierung von Vorschlägen verbessern.
- Kalender und Tagesdetails unterscheiden die laufende Verbindungssuche von der anschließenden Flexpreis-Abfrage. Ein bereits eingegangener Bestpreis beendet die Flexpreis-Ladeanzeige nicht; das gilt auch für nachgeladene Tage. Bereits verfügbare Bestpreise bleiben in ihrer eigenen Ansicht nutzbar. Flexpreise und Bestpreise werden als getrennte Abschnitte dargestellt und verwenden denselben Fahrtverlauf und dieselben Detailaktionen.
- Die aktuelle Produktsprache ist Deutsch. Englisch ist als mögliche spätere zusätzliche Sprache offen, aber noch nicht Teil des aktuellen Produkts.

## Brand Commitments

- Der Produktname lautet `sparpreis.guru`; die kanonische Projektquelle ist `https://github.com/sparpreis-guru/sparpreis.guru`.
- Das öffentliche Deployment wird als nicht-kommerzielles Open-Source-Projekt und technische Demonstration geführt.
- Die Sprache ist direkt, sachlich und verständlich. Preise, Aktualität, Abbrüche und unvollständige Ergebnisse werden ohne verbindliche oder verkäuferische Aussagen beschrieben.
- Bestehende Wortmarke, Favicons und App-Icons bleiben Produktassets; visuelle Festlegungen werden nicht in diesem Produktkontext definiert.

## Evidence on Hand

- Die implementierten Produktoberflächen und Abläufe liegen unter `app/`, `components/bestpreissuche/`, `components/urlaubsfinder/`, `components/direktverbindungen/` und `components/search/`.
- Produktbeschreibung und technische Betriebsinformationen stehen in `README.md`; FAQ- und Datenschutzhinweise stehen in `components/layout/faq-popup.tsx` und `components/layout/footer.tsx`.
- Die Wortmarke liegt als Komponente in `components/layout/brand-logo.tsx`; Favicons und App-Icons liegen unter `app/` und `public/`.
- Der aktuelle Funktionsvertrag steht hier; Cache- und Betriebsregeln stehen in `docs/database-maintenance.md`.
- Das Repository steht unter der MIT License in `LICENSE`.
- Es liegen keine bestätigten Testimonials, Kundenlogos, Auszeichnungen oder unabhängigen Leistungsnachweise vor; zukünftige Arbeiten dürfen solche Belege nicht erfinden.

## Product Principles

1. Flexible Reiseoptionen so zusammenführen, dass Nutzer Tage, Kombinationen und Ziele tatsächlich vergleichen können.
2. Preis, Reisequalität und Verfügbarkeit verständlich darstellen, ohne unverbindliche Suchergebnisse als Verkaufsversprechen auszugeben.
3. Laufende, abgebrochene und unvollständige Suchen ehrlich und nachvollziehbar kommunizieren.
4. Nutzer bei der Reiseplanung unterstützen und für die eigentliche Buchung eindeutig zum Anbieter weiterleiten.
5. Ohne personenbezogene Profile auskommen und nur die für Suche, Cache und Produktverbesserung beschriebenen Daten verarbeiten.
