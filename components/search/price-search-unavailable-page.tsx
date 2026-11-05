"use client"

import type { ReactNode } from "react"
import { useId, useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { ArrowRight, Github, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export function PriceSearchUnavailablePage({ children }: { children: ReactNode }) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const dialogId = useId()
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`

  return (
    <>
      <div inert aria-hidden="true" className="pointer-events-none h-dvh select-none overflow-hidden">
        {children}
      </div>

      <Dialog.Root open>
        <Dialog.Overlay className="fixed inset-0 z-[3000] overflow-y-auto overscroll-contain bg-slate-900/25 backdrop-blur-sm">
          <div className="flex min-h-full items-center justify-center px-4 py-8 sm:p-8">
            <Dialog.Content
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              className="w-full max-w-lg rounded-2xl bg-white shadow-2xl outline-none"
              onOpenAutoFocus={(event) => {
                event.preventDefault()
                titleRef.current?.focus()
              }}
              onEscapeKeyDown={(event) => event.preventDefault()}
              onInteractOutside={(event) => event.preventDefault()}
            >
              <div className="p-6 sm:p-8">
                <ShieldAlert className="mb-5 h-8 w-8 text-amber-600" strokeWidth={1.75} aria-hidden="true" />
                <Dialog.Title id={titleId} ref={titleRef} tabIndex={-1} className="text-xl font-semibold leading-tight text-gray-900 outline-none sm:text-2xl">
                  Preisabfragen machen gerade Pause
                </Dialog.Title>
                <Dialog.Description id={descriptionId} className="mt-3 text-sm leading-relaxed text-gray-600">
                  Akamai, der CDN der Deutschen Bahn, blockiert aktuell die Bahn-Abfragen unseres Servers.
                  Deshalb sind Bestpreissuche und Urlaubsfinder hier vorübergehend deaktiviert.
                </Dialog.Description>

                <div className="mt-6 border-t border-gray-200 pt-6">
                  <h2 className="text-sm font-semibold text-gray-900">Mit einer eigenen Installation weitersuchen</h2>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    Du kannst sparpreis.guru auf deinem Rechner oder Server selbst hosten.
                    Quellcode und Anleitung für den lokalen Start oder Docker findest du auf GitHub.
                  </p>
                  <Button asChild size="lg" className="mt-4 w-full whitespace-normal bg-blue-600 px-4 text-white hover:bg-blue-700">
                    <a href="https://github.com/sparpreis-guru/sparpreis.guru">
                      <Github aria-hidden="true" />
                      Anleitung auf GitHub
                      <ArrowRight aria-hidden="true" />
                    </a>
                  </Button>
                </div>
              </div>

              <div className="rounded-b-2xl border-t border-gray-100 bg-gray-50 px-6 py-4 sm:px-8">
                <p className="text-sm leading-relaxed text-gray-600">Ohne Preisabfrage weiterhin nutzbar:</p>
                <a href="/direktverbindungen" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-blue-700 underline-offset-4 hover:text-blue-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                  Direktverbindungen entdecken
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </Dialog.Content>
          </div>
        </Dialog.Overlay>
      </Dialog.Root>
    </>
  )
}
