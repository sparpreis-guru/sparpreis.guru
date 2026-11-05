'use client'

import { getAppVersion, getCurrentYear } from "@/lib/shared/app-info"
import { ChevronDown, Github } from "lucide-react"
import { useEffect, useState } from "react"
import { useTurnstileEnabled } from "@/components/search/price-search-provider"

interface FooterProps {
  show?: boolean
}

export function Footer({ show = false }: FooterProps) {
  const turnstileEnabled = useTurnstileEnabled()
  const privacyNotice = <>
    Die Anwendung verarbeitet Suchanfragen und kann Ergebnisse zeitweise zwischenspeichern.
    {turnstileEnabled && <> Zum Schutz vor automatisierten Abfragen nutzen wir Cloudflare Turnstile. Dabei werden technische Daten wie deine IP-Adresse an Cloudflare übermittelt. <a href="https://www.cloudflare.com/turnstile-privacy-policy/" className="underline underline-offset-2">Datenschutzhinweise</a>.</>}
  </>
  const currentYear = getCurrentYear()
  const appVersion = getAppVersion()
  const [showFooter, setShowFooter] = useState(show)

  useEffect(() => {
    const shouldShowFooter =
      window.location.hostname === "sparpreis.guru" ||
      show
    setShowFooter(shouldShowFooter)
  }, [show])

  if (!showFooter) return null

  return (
    <footer className="mt-6 border-t border-gray-200 px-3 pt-4 sm:mt-8 sm:px-0 sm:pt-8">
      <details className="group rounded-lg bg-gray-50 sm:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium text-gray-600 [&::-webkit-details-marker]:hidden">
          Projekt- und Datenschutzhinweise
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180"
          />
        </summary>

        <div className="space-y-2 border-t border-gray-200 px-3 py-3 text-[11px] leading-relaxed text-gray-500">
          <p>
            <span className="font-medium text-gray-600">Zweck:</span>{" "}
            Dieses Deployment dient ausschließlich als technische Demonstration des Projekts{" "}
            <a
              href="https://github.com/sparpreis-guru/sparpreis.guru"
              className="underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              sparpreis.guru
            </a>. Es werden keine kommerziellen Zwecke verfolgt.
          </p>
          <p>
            <span className="font-medium text-gray-600">Datenschutz:</span>{" "}
            {privacyNotice}
          </p>
          <p>
            <span className="font-medium text-gray-600">Kontakt:</span>{" "}
            Bei Einwänden (z. B. von Rechteinhabern oder Plattformbetreibern) wird das Deployment auf
            Hinweis hin umgehend deaktiviert. Schreib an{" "}
            <a href="mailto:info@sparpreis.guru" className="underline underline-offset-2">
              info@sparpreis.guru
            </a>
            .
          </p>
        </div>
      </details>

      <div className="hidden grid-cols-3 gap-6 text-left text-xs leading-relaxed text-gray-400 sm:grid">
        <p>
          <span className="mb-1 block font-medium text-gray-600">Technische Demo</span>
          Dieses Deployment dient ausschließlich als technische Demonstration des Projekts{" "}
          <a
            href="https://github.com/sparpreis-guru/sparpreis.guru"
            className="underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            sparpreis.guru
          </a>. Es werden keine kommerziellen Zwecke verfolgt.
        </p>
        <p>
          <span className="mb-1 block font-medium text-gray-600">Datenschutz</span>
          {privacyNotice}
        </p>
        <p>
          <span className="mb-1 block font-medium text-gray-600">Kontakt</span>
          Bei Einwänden (z. B. von Rechteinhabern oder Plattformbetreibern) wird das Deployment auf
          Hinweis hin umgehend deaktiviert. Kontakt:{" "}
          <a href="mailto:info@sparpreis.guru" className="underline underline-offset-2">
            info@sparpreis.guru
          </a>
          .
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500 sm:mt-5 sm:text-sm">
        <div className="whitespace-nowrap">
          © {currentYear} <span className="font-medium text-gray-600">sparpreis.guru</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden min-[380px]:inline">Version {appVersion}</span>
          <span className="min-[380px]:hidden">v{appVersion}</span>
          <a
            href="https://github.com/sparpreis-guru/sparpreis.guru"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-blue-600 hover:underline"
          >
            <Github aria-hidden="true" className="mr-1 h-4 w-4" /> GitHub
          </a>
        </div>
      </div>
    </footer>
  )
}
