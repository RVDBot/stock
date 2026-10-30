'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type { FulfilmentMail } from '@/lib/order-types'

interface Props {
  orderId: number
  onClose: () => void
}

const btn = 'text-[12px] font-medium px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-all duration-150'
const primaryBtn = 'text-[12px] font-medium px-3 py-1.5 rounded-lg bg-accent text-white hover:opacity-90 transition-all duration-150'

export default function FulfilmentMailDialog({ orderId, onClose }: Props) {
  const [mail, setMail] = useState<FulfilmentMail | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'mail' | 'subject' | null>(null)
  const preview = useRef<HTMLDivElement>(null)

  useEffect(() => {
    apiFetch(`/api/orders/mail?id=${orderId}`).then(r => r.json())
      .then(data => { if (data.error) setError(data.error); else setMail(data) })
      .catch(() => setError('Mail kon niet worden opgesteld'))
  }, [orderId])

  function flash(what: 'mail' | 'subject') {
    setCopied(what)
    setTimeout(() => setCopied(null), 2000)
  }

  async function copyMail() {
    if (!mail) return
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([mail.html], { type: 'text/html' }),
        'text/plain': new Blob([mail.text], { type: 'text/plain' }),
      })])
    } catch {
      // The async clipboard needs https; selecting the preview keeps the table formatting
      const selection = window.getSelection()
      if (!preview.current || !selection) return
      const range = document.createRange()
      range.selectNodeContents(preview.current)
      selection.removeAllRanges()
      selection.addRange(range)
      document.execCommand('copy')
      selection.removeAllRanges()
    }
    flash('mail')
  }

  async function copySubject() {
    if (!mail) return
    await navigator.clipboard.writeText(mail.subject).catch(() => {})
    flash('subject')
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface-1 rounded-2xl border border-border-subtle p-5 w-full max-w-4xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-[14px] font-semibold text-text-primary">Mail fulfilment</h2>
          <button onClick={onClose} className={btn}>Sluiten</button>
        </div>

        {error && <p className="text-danger text-[13px]">{error}</p>}
        {!mail && !error && <p className="text-text-tertiary text-[13px]">Mail opstellen...</p>}

        {mail && (
          <>
            {mail.missing_barcodes.length > 0 && (
              <p className="text-warning text-[12px] mb-3">
                Geen barcode bekend voor: {mail.missing_barcodes.join(', ')}
              </p>
            )}
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[13px] text-text-primary flex-1 min-w-0"><span className="text-text-tertiary">Onderwerp:</span> {mail.subject}</p>
              <button onClick={copySubject} className={btn}>{copied === 'subject' ? 'Gekopieerd' : 'Kopieer onderwerp'}</button>
              <button onClick={copyMail} className={primaryBtn}>{copied === 'mail' ? 'Gekopieerd' : 'Kopieer mail'}</button>
            </div>
            {/* White like a mail client, so the preview matches what lands in the mail */}
            <div className="rounded-lg overflow-x-auto bg-white p-4 text-[14px] text-black [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5">
              <div ref={preview} dangerouslySetInnerHTML={{ __html: mail.html }} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
