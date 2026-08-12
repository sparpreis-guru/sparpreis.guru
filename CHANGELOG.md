# Changelog

## [2.3.1](https://github.com/sparpreis-guru/sparpreis.guru/compare/v2.3.0...v2.3.1) (2026-08-12)


### Bug Fixes

* compact queue details in search progress ([c0c912a](https://github.com/sparpreis-guru/sparpreis.guru/commit/c0c912abe816243602e0345bd17c9f5e3233694a))
* improve rate limiter speed ([cec0da0](https://github.com/sparpreis-guru/sparpreis.guru/commit/cec0da0fab839a3ad70389dea1edc668dc349c10))
* keep direct connections available during refresh ([465fc09](https://github.com/sparpreis-guru/sparpreis.guru/commit/465fc091f597555f85801122ac2d3bee5792d24c))
* stabilize search replacement and loading states ([d6843b4](https://github.com/sparpreis-guru/sparpreis.guru/commit/d6843b409e7b35182982fe277612a01375379466))

## [2.3.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v2.2.0...v2.3.0) (2026-08-11)


### Features

* add database maintenance commands ([0d70aab](https://github.com/sparpreis-guru/sparpreis.guru/commit/0d70aabc4a332e9fdc7c0dcea69d94d2a1d95f44))
* improve journey result interactions ([b48e2f4](https://github.com/sparpreis-guru/sparpreis.guru/commit/b48e2f4b25a1e4f4af320b0d7771157df1b0bd0b))


### Bug Fixes

* align direct connection controls ([1925912](https://github.com/sparpreis-guru/sparpreis.guru/commit/19259120a64f9aec06d37617a9a417a39df2a3ba))
* compact search progress shortcut ([8e93e28](https://github.com/sparpreis-guru/sparpreis.guru/commit/8e93e2879b976b14f2166c0871f784fa97811f8f))
* improve search form accessibility ([b21d864](https://github.com/sparpreis-guru/sparpreis.guru/commit/b21d864ddbf18816f5f2ae7693602d70bbb72b14))
* isolate station search traffic ([2c0b509](https://github.com/sparpreis-guru/sparpreis.guru/commit/2c0b509b61acbdeca0ea77aee502a5d06ad1b226))

## [2.2.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v2.1.1...v2.2.0) (2026-08-10)


### Features

* improve search filter controls ([7f2b172](https://github.com/sparpreis-guru/sparpreis.guru/commit/7f2b172c113272c63ce3028e563cc57a041c7f26))
* redesign journey result cards ([6f65934](https://github.com/sparpreis-guru/sparpreis.guru/commit/6f65934d041c862cc911cabe9390e208c76aab36))


### Bug Fixes

* improve mobile round-trip result headers ([8a2d2cd](https://github.com/sparpreis-guru/sparpreis.guru/commit/8a2d2cdfdca0beb05c4d2a0aa622a23ddbf8b475))
* stabilize lazy calendar day loading ([a87b456](https://github.com/sparpreis-guru/sparpreis.guru/commit/a87b456c53b065051f2deb47160e4ce00c3fdd3c))

## [2.1.1](https://github.com/sparpreis-guru/sparpreis.guru/compare/v2.1.0...v2.1.1) (2026-08-09)


### Bug Fixes

* **search:** highlight best-price results without layout shift ([3455928](https://github.com/sparpreis-guru/sparpreis.guru/commit/345592824b3aa23cb07a20d9e78395c2538341bf))
* **search:** prevent matrix jump from forcing focus mode ([bf5e2f9](https://github.com/sparpreis-guru/sparpreis.guru/commit/bf5e2f9770fe662c2591b44410bec54959791c7b))

## [2.1.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v2.0.0...v2.1.0) (2026-08-09)


### Features

* **direktverbindungen:** improve filters and result navigation ([e5a7abd](https://github.com/sparpreis-guru/sparpreis.guru/commit/e5a7abd2cc59fc01d1b2f8da2ca904b9f3b65bb9))
* **search:** add lazy pricing and unified journey results ([adae92b](https://github.com/sparpreis-guru/sparpreis.guru/commit/adae92bd48d39f8c6280514c2198ddeac6078657))
* **urlaubsfinder:** align journey results with best-price search ([4810263](https://github.com/sparpreis-guru/sparpreis.guru/commit/48102633049ce8be9a49e8371a36f8591728e427))


### Bug Fixes

* **klassik:** improve responsive legacy finder ([4dbe1a8](https://github.com/sparpreis-guru/sparpreis.guru/commit/4dbe1a8e5a4beb2410eb63eafb7af32126b2a8af))
* **layout:** optimize mobile page spacing ([48b4652](https://github.com/sparpreis-guru/sparpreis.guru/commit/48b46520c9349c0950012b38e0defe3bca64c857))
* **search:** improve mobile night spacing ([2e1057b](https://github.com/sparpreis-guru/sparpreis.guru/commit/2e1057b4cd5c0b16b7077de74445dcf40a9396a0))
* **search:** improve restarts and progress feedback ([f058b03](https://github.com/sparpreis-guru/sparpreis.guru/commit/f058b03a1da7f5eac16b1f0280bf6e110f6fca84))
* **search:** preserve vehicle types in journey details ([28892bc](https://github.com/sparpreis-guru/sparpreis.guru/commit/28892bc937fab1383178833c530e4ffaf967e5f9))
* **ui:** keep badge colors static ([394cea7](https://github.com/sparpreis-guru/sparpreis.guru/commit/394cea7487a217be0e4bd62733a792d5671d5cf4))

## [2.0.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.4.1...v2.0.0) (2026-08-08)

> [!IMPORTANT]
> **Hinweis für bestehende Installationen**
>
> Mit Version 2.0.0 wechselt sparpreis.guru vollständig in die GitHub-Organisation
> [`sparpreis-guru`](https://github.com/sparpreis-guru). Das kanonische Repository ist ab
> sofort [`sparpreis-guru/sparpreis.guru`](https://github.com/sparpreis-guru/sparpreis.guru),
> und das primäre Docker-Image wird unter
> `ghcr.io/sparpreis-guru/sparpreis-guru` veröffentlicht. Docker Hub und das bisherige
> GHCR-Image werden während der Übergangszeit weiterhin bedient.
>
> **Docker-Nutzer müssen die verwendete Image-Referenz unbedingt auf
> `ghcr.io/sparpreis-guru/sparpreis-guru` umstellen.** Das gilt insbesondere für
> Docker-Compose-Dateien sowie Konfigurationen in Portainer, Watchtower und vergleichbaren
> Deployment-Werkzeugen. Die bisherigen Image-Pfade werden nur vorübergehend gespiegelt und
> sind nicht mehr die dauerhaft unterstützte Bezugsquelle.
>
> Die Direktverbindungsdaten werden künftig als geprüftes Rolling Release aus dem separaten
> Repository
> [`sparpreis-guru/sparpreis.guru-direct-connections-data`](https://github.com/sparpreis-guru/sparpreis.guru-direct-connections-data)
> geladen. Versionen aus der 1.x-Reihe kennen diese neue Datenquelle nicht und erhalten daher
> keine zukünftigen Fahrplandaten mehr. Bestehende Installationen sollten rechtzeitig auf
> Version 2.0.0 oder neuer aktualisiert werden, bevor ihre mitgelieferten Fahrplandaten ablaufen.


### ⚠ BREAKING CHANGES

* Version 2.0.0 uses https://github.com/sparpreis-guru/sparpreis.guru as its canonical repository, changes the primary container image to ghcr.io/sparpreis-guru/sparpreis-guru, and retrieves direct-connections updates exclusively from sparpreis-guru/sparpreis.guru-direct-connections-data. Existing 1.x installations do not know the new data source and must update before their bundled timetable data expires.

### Features

* move distribution to sparpreis-guru organization ([99193e6](https://github.com/sparpreis-guru/sparpreis.guru/commit/99193e60229aa6d1e79a2bd11c0abbfd13455dac))
* **search:** improve progress and price comparison views ([cb3997e](https://github.com/sparpreis-guru/sparpreis.guru/commit/cb3997efddaf8690d59f8a302a070d935247879a))


### Bug Fixes

* **layout:** improve mobile forms and project footer ([2a3c1f4](https://github.com/sparpreis-guru/sparpreis.guru/commit/2a3c1f46a5fedaf7a65a203e8cb3f0d8f8d80669))


### Performance Improvements

* **direct-connections:** accelerate database generation ([478a3cf](https://github.com/sparpreis-guru/sparpreis.guru/commit/478a3cf17fc728a08f388480919894fc55eb441a))

## [1.4.1](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.4.0...v1.4.1) (2026-08-07)


### Bug Fixes

* **dev:** support configured development origins ([dc62e92](https://github.com/sparpreis-guru/sparpreis.guru/commit/dc62e92ecc2dcbc82c3d48be59067b0e2bf6aa15))
* **layout:** prevent mobile content overflow ([e459065](https://github.com/sparpreis-guru/sparpreis.guru/commit/e459065ef3fc3b27b488e9428b8ec87f329e02cc))
* **metrics:** keep queue snapshots in sync ([f55aee6](https://github.com/sparpreis-guru/sparpreis.guru/commit/f55aee625906c30207fb07abd502dbbba4ea9c65))
* **search:** prevent invalid travel date searches ([1705026](https://github.com/sparpreis-guru/sparpreis.guru/commit/1705026b37f49ec522a9e8232a8a091660479089))

## [1.4.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.3.0...v1.4.0) (2026-08-04)

### ⚠️ Wichtiger Hinweis zur Datenbankmigration

Beim ersten Start wird die bestehende Datenbank automatisch migriert.
Dabei wird standardmäßig die Datei
`connection-cache.db.backup-v1-before-v2` angelegt.

Dieses Backup wird nicht automatisch entfernt und kann erheblichen
Speicherplatz belegen. Nach einem erfolgreichen Start und einem
fehlerfreien `pnpm database:check` kann es manuell gelöscht werden,
sofern kein Rollback mehr benötigt wird.

Vor dem Upgrade sollte ausreichend freier Speicherplatz auf dem
Daten-Volume vorhanden sein.

### Features

* **database:** add versioned SQLite migrations ([3c1caec](https://github.com/sparpreis-guru/sparpreis.guru/commit/3c1caecdd5e1a06414cd8e577419bdc26e8e7f93))
* **search:** improve search progress ETA accuracy ([34197bb](https://github.com/sparpreis-guru/sparpreis.guru/commit/34197bb91de6c14819ac4b57fb77c2ce93467050))


### Bug Fixes

* **bestpreissuche:** focus combinations selected from price matrix ([880692d](https://github.com/sparpreis-guru/sparpreis.guru/commit/880692da031c9ee8b3919c65757a355d9785f5f9))
* **bestpreissuche:** prevent price history chart overflow ([0b92056](https://github.com/sparpreis-guru/sparpreis.guru/commit/0b92056d8b362da3da77e3d55e3f3bdc2d75719a))
* **bestpreissuche:** stabilize search lifecycle in strict mode ([e523eed](https://github.com/sparpreis-guru/sparpreis.guru/commit/e523eedc70d7195ff5f9b7c5be40921be10fc3d0))
* **search:** hide inactive sessions from queue status ([f992284](https://github.com/sparpreis-guru/sparpreis.guru/commit/f9922843cc86bcc7763810f377dd567b74135f28))

## [1.3.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.2.4...v1.3.0) (2026-08-04)


### Features

* **bestpreissuche:** add flexible return journey search ([e233b39](https://github.com/sparpreis-guru/sparpreis.guru/commit/e233b39185d2d9331d0bea75064684b51194f58f))
* **direktverbindungen:** show database refresh status ([ba6fbac](https://github.com/sparpreis-guru/sparpreis.guru/commit/ba6fbac234769f139136671b25e7ca1a1cb0d863))
* **klassik:** add classic price calendar mode ([b8d6435](https://github.com/sparpreis-guru/sparpreis.guru/commit/b8d6435b55a2b15e9ecfdf4538f21c3e1b81c562))
* **search:** report fair queue progress ([75851b8](https://github.com/sparpreis-guru/sparpreis.guru/commit/75851b816bdaf18eba5e4d83b23bb6fcf53a07f7))
* **urlaubsfinder:** simplify destination and return search ([f8b7d0a](https://github.com/sparpreis-guru/sparpreis.guru/commit/f8b7d0a94b677af5be686c11d37c5a0cc441e390))


### Bug Fixes

* **bestpreissuche:** handle optional chart tooltip values ([5b1b03e](https://github.com/sparpreis-guru/sparpreis.guru/commit/5b1b03e98478779c220d204849a258df3a7fbcef))
* **deps:** update Next.js and PostCSS ([df13998](https://github.com/sparpreis-guru/sparpreis.guru/commit/df1399826f552757432976d80b42ffd8f6975a9e))
* **search:** handle temporary Bahn API failures ([609b866](https://github.com/sparpreis-guru/sparpreis.guru/commit/609b866a1d5916c2c012cc7e78985dfb6e7ba7eb))

## [1.2.4](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.2.3...v1.2.4) (2026-07-27)


### Bug Fixes

* update undici and other deps ([8aea9aa](https://github.com/sparpreis-guru/sparpreis.guru/commit/8aea9aa66605e076361acb2b4ac87246a82751d8))
* update undici and other deps ([1783857](https://github.com/sparpreis-guru/sparpreis.guru/commit/1783857f83302b547af0a1eae7c7fb8cc7fb8f90))

## [1.2.3](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.2.2...v1.2.3) (2026-06-15)


### Bug Fixes

* stabilize station suggestion ids ([2b04a57](https://github.com/sparpreis-guru/sparpreis.guru/commit/2b04a57c5d4b5e6235396793185159c128b9ed9e))
* stabilize station suggestion ids ([004f707](https://github.com/sparpreis-guru/sparpreis.guru/commit/004f7075d3061f00a62e3c6fcf1937379e47a145))

## [1.2.2](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.2.1...v1.2.2) (2026-06-13)


### Bug Fixes

* Add session & parallelization to Urlaubsfinder ([a1ebb69](https://github.com/sparpreis-guru/sparpreis.guru/commit/a1ebb697e3cc6fcc016ad143a413ce37abd5110b))
* Fahrtverlauf/Preisentwicklung Button misalignment on mobile devices ([a1ebb69](https://github.com/sparpreis-guru/sparpreis.guru/commit/a1ebb697e3cc6fcc016ad143a413ce37abd5110b))
* improve rate limiting and therefore search speed ([a1ebb69](https://github.com/sparpreis-guru/sparpreis.guru/commit/a1ebb697e3cc6fcc016ad143a413ce37abd5110b))
* improve search speed and Urlaubsfinder performance ([a1ebb69](https://github.com/sparpreis-guru/sparpreis.guru/commit/a1ebb697e3cc6fcc016ad143a413ce37abd5110b))

## [1.2.1](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.2.0...v1.2.1) (2026-06-10)


### Bug Fixes

* correct arrival-only time filter behavior ([1345e52](https://github.com/sparpreis-guru/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))
* fix Docker volume permissions for direct connection data ([1345e52](https://github.com/sparpreis-guru/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))
* improve Docker production image and runtime setup ([1345e52](https://github.com/sparpreis-guru/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))
* restore Bahn API requests on Node 24 ([1345e52](https://github.com/sparpreis-guru/sparpreis.guru/commit/1345e52c14845867ea6ef6f916ba0c34b99e00b8))

## [1.2.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.1.2...v1.2.0) (2026-05-29)


### Features

* departure until and arrival from filters ([#49](https://github.com/sparpreis-guru/sparpreis.guru/issues/49)) ([fa1739e](https://github.com/sparpreis-guru/sparpreis.guru/commit/fa1739e849b9c0c07f338c1285d6b9af21299059))


### Bug Fixes

* CI docker build and performance issues ([fa1739e](https://github.com/sparpreis-guru/sparpreis.guru/commit/fa1739e849b9c0c07f338c1285d6b9af21299059))

## [1.1.2](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.1.1...v1.1.2) (2026-05-13)


### Bug Fixes

* **deps:** bump next from 16.2.5 to 16.2.6 for security reasons ([43b17e3](https://github.com/sparpreis-guru/sparpreis.guru/commit/43b17e3ad968d5bfbfc10d14d8ea6439e073233a))

## [1.1.1](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.1.0...v1.1.1) (2026-05-07)


### Bug Fixes

* Overflowing Train Timeline in Urlaubsfinder ([392c37d](https://github.com/sparpreis-guru/sparpreis.guru/commit/392c37d6b72390aa8d3e4e28f1d965bec8a91191))
* Remove package-lock and update CI setup ([8af914d](https://github.com/sparpreis-guru/sparpreis.guru/commit/8af914da625aef330591f17bb34e5c0358efd4df))

## [1.1.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.0.6...v1.1.0) (2026-05-06)


### Features

* add direct connections feature ([e4f7bdd](https://github.com/sparpreis-guru/sparpreis.guru/commit/e4f7bdd55e43a7d21c4c0fafadce00f6f46c3294))
* **observability:** add structured logs and search metrics ([b30b791](https://github.com/sparpreis-guru/sparpreis.guru/commit/b30b79127fe71e41bd06d01b07281bbb63d55d0f))
* **search:** improve station matching and suggestion ranking ([fc4e658](https://github.com/sparpreis-guru/sparpreis.guru/commit/fc4e65856e5e8e7a04bc4c7add89ad411414a547))
* **urlaubsfinder:** add vacation destination search ([027ed3e](https://github.com/sparpreis-guru/sparpreis.guru/commit/027ed3e013f7f88c0c7552d128a893bbb85f8e61))


### Bug Fixes

* Add feature flag and prop to control Footer ([e0070cc](https://github.com/sparpreis-guru/sparpreis.guru/commit/e0070cc5908ee122f4553f40d8a4cf1b9afb9ee6))
* **ci:** use node 22 for docker builds ([2dd36e7](https://github.com/sparpreis-guru/sparpreis.guru/commit/2dd36e7f5f3e095d2ec599cde2241c8ac1efccc1))
* restore urlaubsfinder journey times ([57a9adf](https://github.com/sparpreis-guru/sparpreis.guru/commit/57a9adff8103ffab1a50532768a510bb009bafcc))

## [1.0.6](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.0.5...v1.0.6) (2026-02-15)


### Bug Fixes

* cache metrics, debug endpoint & footer ([74fa463](https://github.com/sparpreis-guru/sparpreis.guru/commit/74fa4631bb07432f52877b56905bd8f874e98f5c))
* Switch release-please release-type to node ([1f08b2d](https://github.com/sparpreis-guru/sparpreis.guru/commit/1f08b2db699f163909f9f1c1dfd636382ad018f1))

## [1.0.5](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.0.4...v1.0.5) (2026-01-29)


### Bug Fixes

* next CVE ([0fb751e](https://github.com/sparpreis-guru/sparpreis.guru/commit/0fb751e3bc2a94485722374b36ebc19140da0308))

## [1.0.4](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.0.3...v1.0.4) (2026-01-10)


### Bug Fixes

* session completion ([f66df53](https://github.com/sparpreis-guru/sparpreis.guru/commit/f66df53c539a2468dee53253dfff866346b2108a))
* time filter and connection ID logic ([#22](https://github.com/sparpreis-guru/sparpreis.guru/issues/22)) ([cc3a1a9](https://github.com/sparpreis-guru/sparpreis.guru/commit/cc3a1a94edd22121edc62d7311dd306f84c98bda))

## [1.0.3](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.0.2...v1.0.3) (2026-01-06)


### Bug Fixes

* re-rendering of PriceHistoryChart when new results come in ([c7b2475](https://github.com/sparpreis-guru/sparpreis.guru/commit/c7b2475c0e338dde74a84226892ccf7e4c066467))
* Wrong train names for regional trains ([ea67a10](https://github.com/sparpreis-guru/sparpreis.guru/commit/ea67a10b502865037d369b01815ce1b31fe708d2))

## [1.0.2](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.0.1...v1.0.2) (2026-01-02)


### Bug Fixes

* Bump qs from 6.14.0 to 6.14.1 ([f095189](https://github.com/sparpreis-guru/sparpreis.guru/commit/f0951897e52b49f67d3878e1dbd184c2b4edee7d))
* Change default for showOnlyCheapest to false ([fda5246](https://github.com/sparpreis-guru/sparpreis.guru/commit/fda52464667875114460c86f85755dff69b8ee5d))
* date selection to use weekdays and ranges ([bc44a51](https://github.com/sparpreis-guru/sparpreis.guru/commit/bc44a5167f35fcac904a3d5eb2ff56e41fa6a1cc))

## [1.0.1](https://github.com/sparpreis-guru/sparpreis.guru/compare/v1.0.0...v1.0.1) (2025-12-29)


### Bug Fixes

* Improve day navigation with animated transitions ([4db19b6](https://github.com/sparpreis-guru/sparpreis.guru/commit/4db19b6b13587a8c6c88396eb3058455261af406))
* mobile data age display ([3748ddd](https://github.com/sparpreis-guru/sparpreis.guru/commit/3748ddd581552527746d13773dfaa09580ada9a0))

## [1.0.0](https://github.com/sparpreis-guru/sparpreis.guru/compare/v0.9.10...v1.0.0) (2025-12-28)


### ⚠ BREAKING CHANGES

* Results and stations are now cached in an SQLite Database. Make sure to set a volume to /app/data to keep the database persistent.

### Features

* prepare 1.0.0 release ([842c645](https://github.com/sparpreis-guru/sparpreis.guru/commit/842c645ab79446ee9dfd7fc2adbfd83912737047))
