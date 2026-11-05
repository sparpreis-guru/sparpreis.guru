---
name: sparpreis.guru
description: Ein kompaktes digitales Fahrplanblatt für den Vergleich flexibler Bahnreisen.
colors:
  primary: "#2563eb"
  primary-hover: "#1d4ed8"
  primary-soft: "#eff6ff"
  surface: "#ffffff"
  surface-muted: "#f9fafb"
  surface-subtle: "#f3f4f6"
  text-strong: "#111827"
  text: "#374151"
  text-muted: "#6b7280"
  border: "#e5e7eb"
  border-strong: "#d1d5db"
  price-best: "#15803d"
  price-best-bg: "#f0fdf4"
  price-mid: "#b45309"
  price-mid-bg: "#fffbeb"
  danger: "#b91c1c"
  danger-bg: "#fef2f2"
  direct: "#7e22ce"
  direct-bg: "#faf5ff"
typography:
  micro:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "normal"
  display:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "clamp(1.875rem, 4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "normal"
  headline:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.333
    letterSpacing: "normal"
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.5rem"
  xl: "0.75rem"
  pill: "9999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0.75rem 1.5rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.75rem"
    height: "2.75rem"
  filter-chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0.375rem 0.75rem"
  card-result:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "0.75rem"
  badge-best:
    backgroundColor: "{colors.price-best-bg}"
    textColor: "{colors.price-best}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.5rem"
  nav-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-hover}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
---

# Design System: sparpreis.guru

## Overview

**Creative North Star: "Das digitale Fahrplanblatt"**

sparpreis.guru ist eine klare, sachliche und hilfreiche Arbeitsoberfläche für eine informationsreiche Reiseplanung. Wie ein gut gesetztes Fahrplanblatt ordnet das System viele Zeiten, Preise, Orte und Zustände in stabile Raster, damit Nutzer schnell vergleichen können, ohne dass die Oberfläche selbst um Aufmerksamkeit konkurriert.

Die moderne Produktoberfläche ist kompakt, hell und überwiegend flach. Weiß und ruhige Grautöne bilden die Arbeitsfläche; Fahrplanblau führt durch Interaktionen, während Preis- und Statusfarben ausschließlich fachliche Bedeutung tragen. Der eigenständige Klassikmodus ist eine bewusst isolierte historische Darstellung und keine Vorlage für neue moderne Oberflächen.

**Key Characteristics:**

- Hohe Informationsdichte mit klarer Gruppierung statt großer Leerflächen.
- Fahrplanblau als eindeutiges Interaktions- und Navigationssignal.
- Preis- und Statusfarben als Datenkodierung, nicht als Dekoration.
- Feine Rahmen und tonale Ebenen; Schatten nur bei tatsächlicher Hervorhebung oder Überlagerung.
- Responsive Verdichtung mit lokalem Innenabstand und wenigen semantischen Bedienelementen.

## Colors

Die Palette verbindet neutrales Fahrplanpapier mit einem klaren Bedienblau und sparsam eingesetzten semantischen Farben.

### Primary

- **Fahrplanblau** (`primary`, #2563eb): Primäre Aktionen, aktive Filter, Links, Icons und fokussierte Zustände.
- **Tiefes Fahrplanblau** (`primary-hover`, #1d4ed8): Hover- und verstärkte aktive Zustände.
- **Helles Fahrplanblau** (`primary-soft`, #eff6ff): Ruhige Auswahlflächen, informative Hintergründe und unterstützende Hervorhebungen.

### Neutral

- **Papierweiß** (`surface`, #ffffff): Seiten-, Karten-, Feld- und Popoverflächen.
- **Leises Papiergrau** (`surface-muted`, #f9fafb): Großzügige Modul- und Abschnittshintergründe.
- **Rastergrau** (`surface-subtle`, #f3f4f6): Segmentierte Steuerungen, Tabellenköpfe und stärker abgesetzte Ebenen.
- **Fahrplanschwarz** (`text-strong`, #111827): Zeiten, Preise, Überschriften und andere Primärinformationen.
- **Lesegrau** (`text`, #374151): Lauftext, Feldwerte und sekundäre Fakten.
- **Hinweisgrau** (`text-muted`, #6b7280): Beschreibungen, Metadaten und inaktive Zustände.
- **Feines Raster** (`border`, #e5e7eb): Standardrahmen und Trenner.
- **Kräftiges Raster** (`border-strong`, #d1d5db): Interaktive Feldrahmen und klarer abgegrenzte Karten.

### Semantic

- **Preisgrün** (`price-best` / `price-best-bg`, #15803d / #f0fdf4): Beste Preise, positive Zustände und ihre ruhige Hintergrundfläche.
- **Hinweisamber** (`price-mid` / `price-mid-bg`, #b45309 / #fffbeb): Mittlere Preisbänder, Hinweise und prüfenswerte Zustände.
- **Fehlerrot** (`danger` / `danger-bg`, #b91c1c / #fef2f2): Fehler, Abbruch und destruktive Aktionen.
- **Direktviolett** (`direct` / `direct-bg`, #7e22ce / #faf5ff): Fachlich abgegrenzte Direkt- oder Sonderkennzeichnungen, wenn Blau bereits die Interaktion trägt.

**Die Fahrplanblau-Regel.** Fahrplanblau kennzeichnet Bedienung, Auswahl oder Navigation; es wird nicht als großflächige Dekoration eingesetzt.

**Die Preisfarbe-ist-Daten-Regel.** Grün, Amber und Rot werden nur verwendet, wenn sie eine echte Preis- oder Statusaussage transportieren.

## Typography

**Display Font:** Geist (mit Arial und `sans-serif` als Fallback)

**Body Font:** Geist (mit Arial und `sans-serif` als Fallback)

**Character:** Geist hält Zahlen, Bahnhofsnamen und kurze Bedienbegriffe neutral und gut scannbar. Gewicht, Größe und tabellarische Ziffern erzeugen Hierarchie; es gibt keine dekorative Zweitschrift.

### Hierarchy

- **Micro** (500, 10 px, Zeilenhöhe 1.2): ausschließlich für sehr enge Kalender-Metadaten wie Routenabdeckung und Ladehinweise; nie für erklärenden Text.
- **Display** (700, 30–36 px, Zeilenhöhe 1): ausschließlich die Wortmarke und sehr seltene Identitätsmomente.
- **Headline** (700, 20 px, Zeilenhöhe 1.25): Seiten- und Ergebnisüberschriften.
- **Title** (600, 16 px, Zeilenhöhe 1.5): Modulüberschriften, wichtige Zusammenfassungen und aktive Navigation.
- **Body** (400, 14 px, Zeilenhöhe 1.5): Fakten, Erklärungen und reguläre Steuerelemente; mobile Eingabefelder verwenden 16 px, um Browser-Zoom zu vermeiden.
- **Label** (500, 12 px, Zeilenhöhe 1.333): Feldbezeichnungen, Metadaten und kompakte Statushinweise. Versalien mit leichtem Tracking bleiben kurzen Strukturlabels vorbehalten.

Preise und Uhrzeiten verwenden tabellarische Ziffern. Wichtige Werte sind fett, ihre Einheit oder Erläuterung bleibt ruhiger; Bahnhofsnamen dürfen umbrechen oder gezielt gekürzt werden, aber nicht durch interne IDs ersetzt werden.

**Die Scan-vor-Show-Regel.** Typografie dient zuerst der schnellen Erfassung von Zeiten, Orten, Preisen und Zuständen; dekorative Größen- oder Schriftsprünge sind systemfremd.

## Layout

Der Hauptinhalt liegt in einem zentrierten Container mit maximal 72 rem Breite und 24 px vertikalem Seitenrhythmus. Auf Mobilgeräten ist der Seitencontainer außen bündig; notwendige 12–16 px Innenabstände liegen an Headern, Formularmodulen und Inhaltsabschnitten. Ab 640 px erhält der Container wieder 16 px seitlichen Innenabstand.

Formulare und Ergebnisbereiche folgen einem gestapelten Arbeitsfluss. Einspaltige mobile Gruppen wechseln ab 640 oder 768 px in Zwei- oder Mehrspaltenraster. Abstände basieren überwiegend auf 4, 8, 12, 16, 24 und 32 px. Innerhalb dichter Karten dominieren 8–12 px; 24–32 px markieren Seiten- oder Abschnittswechsel.

Mobile Ergebnisköpfe reservieren rechts eine feste Preisfläche. Status, Gesamtzeit und Badges dürfen kontrolliert umbrechen, aber nicht unter den Preis laufen. Sekundäre Ansichten wie Liste und Preismatrix werden über wenige eindeutige Steuerungen direkt erreichbar gemacht; ausführliche Statusinformationen bleiben im Dokumentfluss, während schwebende Elemente nur kompakte Sprung- oder Zustandsfunktionen übernehmen.

**Die Lokaler-Innenabstand-Regel.** Mobile Seiten bleiben außen bündig; Innenabstand wird an der tatsächlichen Inhaltsgruppe vergeben, nicht durch eine pauschale äußere Kartenhülle.

## Elevation & Depth

Das System ist flach mit feinen Rahmen und tonalen Ebenen. Ruhende Standardflächen werden primär durch Weiß, Grau und 1 px starke Rahmen getrennt. Ein kleiner Flächenschatten (`0 1px 2px rgba(0,0,0,0.05)`) unterstützt Karten, aktive Navigationssegmente und kompakte Preisflächen. Ergebniskarten verwenden einen etwas definierteren Schatten (`0 1px 4px rgba(15,23,42,0.10)`). Stärkere Schatten gehören Popovern, Dialogen, Dropdowns und mobilen Sticky-Aktionen.

### Shadow Vocabulary

- **Flächenhebung** (`0 1px 2px rgba(0,0,0,0.05)`): dezente Abhebung kleiner interaktiver Flächen.
- **Ergebniskarte** (`0 1px 4px rgba(15,23,42,0.10)`): lesbare Trennung wiederholter Ergebniszeilen.
- **Überlagerung** (`0 10px 15px -3px rgba(0,0,0,0.10), 0 4px 6px -4px rgba(0,0,0,0.10)`): Dropdowns, Dialoge und schwebende Aktionsleisten.

**Die Flach-im-Ruhezustand-Regel.** Schatten zeigen eine echte Ebene oder Priorität; sie werden nicht dekorativ auf jede Karte gelegt.

## Shapes

Die Formensprache ist sanft gerundet und technisch geordnet. Kleine Marker und Skeleton-Bausteine verwenden 4 px, Felder und kompakte Buttons 6 px, Standardkarten und Primäraktionen 8 px und größere Formularmodule 12 px. Vollständig runde Formen sind Badges, Filterchips, Icon-Schaltflächen und Statuspunkte vorbehalten.

Rahmen sind überwiegend 1 px stark. Auswahl wird durch Farbe, Tonfläche oder einen gleichbleibend breiten Ring gezeigt. Unterschiedlich dicke Seitenränder, die Inhalte beim Zustandswechsel verschieben, gehören nicht zum System.

## Components

### Buttons

- **Shape:** kompakt und sanft gerundet (6 px für Standard-, 8 px für Primäraktionen).
- **Primary:** Fahrplanblau mit weißer Schrift, 44 px Höhe und 24 px horizontalem Innenabstand; immer mit einem eindeutigen Verb oder Suchziel.
- **Hover / Focus:** dunkleres Fahrplanblau bei Hover; sichtbarer 2 px Fokusring mit Abstand zur Kontur. Deaktivierte Zustände reduzieren Deckkraft und entfernen den Aktionscursor.
- **Secondary / Ghost:** weiße oder transparente Fläche mit grauer Schrift und feinem Rahmen; Hover verschiebt Rahmen oder Text kontrolliert ins Fahrplanblau.

### Chips

- **Style:** pillenförmig, 1 px Rahmen, 12 px horizontale und 6 px vertikale Polsterung.
- **State:** ausgewählte Filter sind vollflächig Fahrplanblau mit weißer Schrift; nicht ausgewählte Filter bleiben weiß mit grauem Text. Fachliche Badges verwenden ihre semantische Tonfläche und sind keine Buttons.

### Cards / Containers

- **Corner Style:** 8 px für Ergebnisse und Inhaltskarten, 12 px für größere Formularmodule.
- **Background:** Papierweiß als Basis; leises Papiergrau oder helles Fahrplanblau gliedern Unterbereiche.
- **Shadow Strategy:** flach im Ruhezustand; Ergebniskarten und echte Überlagerungen folgen der definierten Schattenhierarchie.
- **Border:** 1 px feines Raster; wichtige Ergebniszustände ändern Farbe und Tonfläche bei gleichbleibender Rahmenbreite.
- **Internal Padding:** 12 px mobil, meist 16 px ab dem kleinen Breakpoint.

### Inputs / Fields

- **Style:** 44 px hohe weiße Felder mit 6 px Radius, 1 px Rahmen und 12 px horizontalem Innenabstand.
- **Focus:** klarer 2 px Ring oder blauer Rahmen; Fokus darf nicht nur über einen Schatten kommuniziert werden.
- **Error / Disabled:** Fehlerrot mit ruhiger roter Tonfläche; deaktivierte Felder bleiben lesbar, reduzieren aber Deckkraft und zeigen einen nicht-interaktiven Cursor.

### Navigation

Die Desktopnavigation ist eine kompakte segmentierte Leiste auf Rastergrau. Der aktive Eintrag liegt als weiße, leicht gehobene Fläche mit tiefblauer Schrift darauf; inaktive Einträge bleiben grau und wechseln bei Hover kontrolliert ins Blau. Mobil wird dieselbe kleine Anzahl von Zielen in einem Menü hinter einer quadratischen 36 px Schaltfläche angeboten.

### Journey Result

Die Ergebniskarte ist die Signaturkomponente des Systems. Kopf, Fahrtinformationen, Preisfläche und Aktionen folgen einem stabilen Raster. Uhrzeiten und Preise besitzen die höchste numerische Hierarchie; Bahnhofsnamen, Dauer und Umstiege bleiben sichtbar, aber ruhiger. Buchungsaktionen stehen beim Preis beziehungsweise mobil bei den Detailaktionen. Bestpreise werden durch hellgrüne Fläche und kräftigeren grünen Rahmen markiert, ohne die Kartenbreite zu verändern. Ladezustände reservieren dieselbe Grundstruktur und nahezu dieselbe Höhe wie die späteren Inhalte.

Routenabhängige Tarife zeigen im Kalender den Flexpreis einer festen Vergleichsverbindung mit derselben beobachteten Haltefolge und Produktklasse. Die Vergleichsbasis bleibt als „Reiseweg“ sichtbar und ist bei mehreren beobachteten Wegen über ein Auswahlfeld wechselbar. Fehlende passende Treffer und Abfragefehler erhalten ausdrückliche Statusanzeigen; sie werden nicht durch Preise anderer Routen ersetzt. Im Tagesdetail steht die „Vergleichsverbindung“ zuerst. Jede tatsächlich geprüfte Fahrt nutzt die gemeinsame `OneWayJourneySummary`, `JourneyResultActionBar` und den aufklappbaren `OneWayJourneyDetails`-Fahrtverlauf in einer kompakten, umrandeten Ergebniszeile mit Produktklasse, Preis, tatsächlichen Abfahrts- und Ankunftszeiten, Umstiegen und Fahrtverlauf; Zeiten und Fahrtdauer werden nicht als „typisch“ bezeichnet oder aus einer anderen Fahrt übernommen. Weitere geprüfte Angebote erscheinen separat und werden nur auf Nutzerwunsch über „Weitere Flexpreise prüfen“ abgefragt; bei Teilfehlern bleiben erfolgreiche Angebote sichtbar und der Fehler wird ausdrücklich benannt. Die als „Über“ gezeigten Zwischenhalte beschreiben den Fahrtverlauf, keine tarifliche Via-Angabe; gleiche Preise belegen keine gleiche Streckengültigkeit. Die Ermittlungshinweise liegen hinter einer flachen weißen Infozeile. Es gibt weder eine Garantie für den niedrigsten Preis über alle Routen noch eine Vollständigkeitsgarantie oder prozentuale Verbindungsabdeckung. Die ruhige gemeinsame Aktionszeile verwendet auch für den generischen Buchungssuche-Fallback „Fahrt buchen“ und erklärt, dass eine Bahn-Suche zur Abfahrtszeit geöffnet wird, in der die passende Verbindung und der Flexpreis auszuwählen sind. Zwei eigenständige, durch Abstand getrennte Module kennzeichnen „Flexpreise“ mit blauem Kopf und „Bestpreise“ mit neutralem Kopf, ohne die Ergebnisse pauschal als Sparpreise oder mit gesicherter Zugbindung auszuweisen. Beim Tageswechsel bewegen sich Flexpreisvergleich und Bestpreisliste gemeinsam als eine Einheit; bei reduzierter Bewegung entfallen Verschiebung, Überblendung und Übergangsdauer. Das bestehende kompakte Fahrplanblau mit Slate-Neutraltönen, leicht getönten Modulköpfen und gemeinsamen umrandeten Ergebniszeilen bleibt erhalten.

Die Reisewegauswahl folgt einem festen Informationsraster: auf breiten Flächen links das beschriftete Auswahlfeld, rechts die Treffer dieser Suche. Fahrzeit, übliche Umstiege, Fahrtenzahl und Reisetage stehen in vier ausgerichteten Spalten mit kurzen Beschriftungen und umrandeten Badges einschließlich der Ergebnissymbole (Uhr, Umstieg, Bahn, Kalender). Blau betont nur die Umstiegsangabe; die Fahrzeit liegt auf Slate, Fahrtenzahl und Reisetage auf neutralem Weiß. Auf schmalen Flächen folgt dieser Faktenbereich in einem 2×2-Raster unter der Auswahl; Zusätzliche Leerhöhen für die Beschriftungen entfallen. Die Auswahloptionen nennen ebenfalls die übliche Umstiegszahl. Die Direktangabe verwendet unmittelbar die gemeinsame `DirectJourneyBadge`-Komponente. Innenabstände und Rasterabstände sind kompakt; die zusätzliche Überschrift der Kennzahlen ist nur für Screenreader vorhanden. Kennzahlen bleiben nicht interaktiv; es gibt keine eigenen Kennzahlenkarten. Im Tagesergebnis steht die globale Reisewegauswahl in einer hellen Bedienzeile unter dem blauen Flexpreis-Kopf, nicht als Teil der blauen Titelzeile. Auswahlfeld, Änderungsaktion, Faktenraster, Symbole, Abstände und Flächen sind oben und unten identisch; nur die ausführliche Erklärung erscheint ausschließlich über dem Kalender. Beide Einstiege verwenden dieselbe Select-Komponente, eindeutige IDs und denselben Zustand. Weiße Fläche, grauer Rahmen, dunkler Text, Hover-Rahmen, sichtbarer Fokus und mindestens 44 px Höhe kennzeichnen die Auswahl als Bedienelement. Bei nur einem verfügbaren, gewählten Weg entfällt die Änderungsaktion. Hinweise liegen über die volle Modulbreite in beschrifteten Zeilen für Vorauswahl, Ticketgültigkeit und Preisvergleich. Sichtbarer Hinweis und Details benennen ausdrücklich andere tarifliche VIA-Strecken und Produktklassen als mögliche Preisunterschiede; eine identische beobachtete Haltefolge gilt nicht als Nachweis gleicher Ticketgültigkeit. Fahrtverlauf und Angebotsdetails verwenden die gemeinsamen Ergebnisaktionen. Ein Reisewegwechsel erhält die Tagesauswahl und die bestehenden Module. Das automatische Scrollen zur Fortschrittsanzeige ist bei dieser Neuberechnung ausdrücklich deaktiviert; eine neue Suche behält ihr bisheriges Scrollverhalten. Alte Flexpreise werden durch Ladezustände ersetzt.

Der Kalenderfuß reserviert im Flexpreisvergleich dieselbe Textfläche für den allgemeinen Gültigkeitshinweis und den Hinweis auf fehlende Vergleichstreffer, auch bei schmalen Zeilenumbrüchen. Laufende Flexpreis-Abfragen gelten dabei nicht als fehlende Vergleichstreffer. Kalenderzellen reservieren unter der Tageszahl einen begrenzten Inhaltsbereich. Ladeanzeige, Ergebnis und Nachladeaktion schließen einander aus; ein bereits empfangener Bestpreis beendet eine noch laufende Flexpreis-Abfrage nicht. Auch nachgeladene Zusatztage bleiben bis zum Flexpreis-Ergebnis im Ladezustand, ohne die Zelle zu vergrößern. Im Tagesdetail verwenden die offene Flexpreis-Abfrage und das Ergebnis dieselbe `OneWayJourneySummary` mit gleicher Kopf-, Reiseweg- und Aktionszeile. Bekannte Start- und Zielnamen, Produktklasse und gewählter Reiseweg bleiben sichtbar. Nur noch fehlende konkrete Fahrtangaben und der Preis werden durch Platzhalter in der jeweiligen Textzeilenhöhe ersetzt; typische Kennzahlen oder Angaben einer anderen Fahrt werden nicht als konkrete Fahrtwerte übernommen. Die Preisfläche reserviert dieselbe Mindestbreite, die Detail- und Prüfaktionen behalten ihren Platz und sind bis zum Ergebnis deaktiviert. Der Ladestatus wird ohne zusätzliche sichtbare Statuszeile zugänglich angekündigt. Die Aktion „Weitere Flexpreise prüfen“ bleibt auch während der Suche sichtbar und ist bis zum Abschluss aller laufenden Abfragen deaktiviert; das Suchende fügt keine neue Aktionszeile hinzu. Abbruch und Fehler beenden die Animation; bei reduzierter Bewegung bleiben Spinner und Platzhalter statisch. Unter 768 px zeigen Kalenderzellen wie bisher auf volle Euro gerundete Kurzpreise ohne Abstand vor dem Eurozeichen; breitere Ansichten behalten zwei Nachkommastellen. Exakte Beträge bleiben in zugänglicher Beschriftung, Tooltip und Tagesdetails erhalten. Die kompakte Preiszeile nutzt schmale Zellinnenabstände und kleinere Ziffern, sodass dreistellige Beträge Platz finden. Daten, Sortierung und Preisfarben werden nicht gerundet.

**Die Zustandsklarheit-Regel.** Interaktive Kontrolle, fachlicher Status und reine Information müssen durch Form, Farbe und Verhalten eindeutig unterscheidbar bleiben.

## Sicherheitsprüfung

Der Kopf des einfachen Preiskalenders steht bereits während der Sicherheitsprüfung mit den beim Suchstart gewählten Stationsnamen. Solange keine API-Metadaten vorliegen, stammen diese aus dem Formularzustand. Die Preisbeschriftung und ein gleich hoch angelegter Platzhalter reservieren den Angebotsbereich, bevor der erste Preis eintrifft. Geplante Reisetage werden bis zum ersten Ergebnis als geplant bezeichnet. Der Übergang zur Preisabfrage fügt keinen zusätzlichen Kalenderkopf ein.

Bahnhofssuchen prüfen bei Bedarf automatisch im Hintergrund und reservieren keinen zusätzlichen Platz im Formular. Ihr Widget bleibt mit `interaction-only` eingebunden und wechselt nur bei erforderlicher Bestätigung in denselben modalen Dialog. Die Erklärung nennt in diesem Fall ausdrücklich die Bahnhofssuche. Technische Fehler werden über die vorhandenen Fehlertexte am Bahnhofsfeld angezeigt. Der Stations-Dialog ist unabhängig von der Preis-Fortschrittsanzeige und verändert deren Zustand und Containermaße nicht.

Während der automatischen Prüfung füllt ein kompakter Ablauf „Sicherheit prüfen → Preise suchen“ den reservierten Inhaltsbereich. Die Containermaße, Abstände und Schriftgrößen entsprechen der vorhandenen Fortschrittsanzeige: 14 px für die Überschrift, 12 px für Ablauf und Hinweise. Die Hervorhebung erfolgt ausschließlich durch Schildsymbol, Fahrplanblau und halbfette Beschriftung des aktuellen Schritts; zusätzliche Hintergrundflächen und Innenabstände entfallen. Lupe und graue Beschriftung zeigen den anschließenden Suchschritt. Eine dünne Verbindungslinie ordnet den Ablauf, ohne einen messbaren Fortschritt vorzutäuschen. „Bitte warte kurz“ ist innerhalb des kompakten Hinweistexts dunkler betont. Wird eine Interaktion angefordert, wechseln Schritt und Hinweis zu „Bestätigung nötig“ und einer konkreten Aufforderung für das geöffnete Fenster. Der Cloudflare-Datenschutzhinweis bleibt darunter sichtbar.

Die automatische Turnstile-Prüfung ist die erste Phase der gemeinsamen Fortschrittsanzeige. Überschrift und Kurztext benennen die Prüfung; die vorhandene Abbruchaktion und das Scrollziel bleiben erhalten. Prozentwerte, Restzeit und Queue-Hinweise erscheinen erst bei der eigentlichen Suche. Der Inhaltsbereich reserviert dieselbe Mindesthöhe für beide Phasen. Cloudflares Widget bleibt während der Prüfung eingebunden. Nur wenn es eine Nutzereingabe anfordert, wird dasselbe Widget in einem zentrierten, responsiven Dialog mit kurzer Erklärung und Schließen-Aktion angezeigt. Die flexible Widget-Breite nutzt die verfügbare Fläche. Nach Abschluss zeigt dasselbe Fortschrittsmodul den Suchfortschritt, ohne erneut zu scrollen. Fehler werden im bestehenden Ergebnisbereich erklärt. Im Klassikmodus verwendet die Prüfung die vorhandene Statuszeile mit fester Mindesthöhe; ein sichtbares Widget liegt außerhalb des Dokumentflusses und fügt keine Zeile hinzu.

## Do's and Don'ts

### Do:

- **Do** use Fahrplanblau für aktive Bedienung und semantische Farben nur für echte Daten- oder Statusaussagen.
- **Do** preserve kompakte 8–16 px Innenabstände innerhalb dichter Arbeitsmodule.
- **Do** reserve stable space for prices, badges, station names, actions and loading states.
- **Do** reuse the shared journey-result, sorting and status patterns across all modern search surfaces.
- **Do** keep the Klassikmodus visually isolated as an intentional legacy exception.

### Don't:

- **Don't** use verspielte Reiseportal-Optik, dekorative Illustrationen oder große Hero-Gesten in den Arbeitsoberflächen.
- **Don't** use übergroße Karten, übermäßige Abstände oder dekorative Schatten, die die Informationsdichte schwächen.
- **Don't** create Ansammlungen gleichwertig wirkender Buttons when one semantic selector and one direction control are sufficient.
- **Don't** mark a best price with a thicker side border that shifts content; keep border width stable and use tone plus color.
- **Don't** animate or darken status badges on hover; badges communicate state and are not controls.
