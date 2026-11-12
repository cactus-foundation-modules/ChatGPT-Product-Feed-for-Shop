'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsHeaderActions, SettingsHeaderStatus } from '@/components/admin/SettingsHeaderActions'
import { InfoTip } from '@/components/admin/InfoTip'
import { CONDITIONS, type Condition } from '@/modules/chatgpt-product-feed-for-shop/lib/types'
import { FEED_FILES, type FeedFile } from '@/modules/chatgpt-product-feed-for-shop/lib/feed-format'

const API_BASE = '/api/m/chatgpt-product-feed-for-shop/admin'

type Settings = {
  enabled: boolean
  sellerName: string | null
  defaultBrand: string | null
  brandFromSupplier: boolean
  mpnFromSku: boolean
  defaultCondition: Condition
  includeOutOfStock: boolean
  acceptsReturns: boolean | null
  returnWindowDays: number | null
  returnPolicyUrl: string | null
  adsEligible: boolean
  lastFetchedAt: string | null
  lastFetchedItems: number | null
  lastFetchAgent: string | null
  feedUrls: Record<FeedFile, string | null>
  effectiveSellerName: string | null
}

type Draft = {
  enabled: boolean
  sellerName: string
  defaultBrand: string
  brandFromSupplier: boolean
  mpnFromSku: boolean
  defaultCondition: Condition
  includeOutOfStock: boolean
  acceptsReturns: 'unset' | 'yes' | 'no'
  returnWindowDays: string
  returnPolicyUrl: string
  adsEligible: boolean
}

type Preview = {
  itemCount: number
  groupCount: number
  sellerName: string
  withheldCount: number
  withheldCounts: Record<'no-image' | 'no-brand' | 'no-price', number>
  withheld: Array<{ id: string; title: string; reason: 'no-image' | 'no-brand' | 'no-price' }>
  sample: Array<Record<string, unknown>>
}

const FORMAT_LABELS: Record<FeedFile, string> = {
  'products.csv': 'CSV',
  'products.csv.gz': 'CSV, compressed (.gz)',
  'products.tsv': 'TSV',
  'products.tsv.gz': 'TSV, compressed (.gz)',
  'products.jsonl': 'JSON Lines',
  'products.jsonl.gz': 'JSON Lines, compressed (.gz)',
}

const REASON_LABELS: Record<'no-image' | 'no-brand' | 'no-price', string> = {
  'no-image': 'No photo',
  'no-brand': 'No brand',
  'no-price': 'No price',
}

const CONDITION_LABELS: Record<Condition, string> = { new: 'New', refurbished: 'Refurbished', used: 'Used' }

function draftOf(s: Settings): Draft {
  return {
    enabled: s.enabled,
    sellerName: s.sellerName ?? '',
    defaultBrand: s.defaultBrand ?? '',
    brandFromSupplier: s.brandFromSupplier,
    mpnFromSku: s.mpnFromSku,
    defaultCondition: s.defaultCondition,
    includeOutOfStock: s.includeOutOfStock,
    acceptsReturns: s.acceptsReturns === null ? 'unset' : s.acceptsReturns ? 'yes' : 'no',
    returnWindowDays: s.returnWindowDays ? String(s.returnWindowDays) : '',
    returnPolicyUrl: s.returnPolicyUrl ?? '',
    adsEligible: s.adsEligible,
  }
}

function bodyOf(d: Draft) {
  const days = Math.trunc(Number(d.returnWindowDays))
  return {
    enabled: d.enabled,
    sellerName: d.sellerName,
    defaultBrand: d.defaultBrand,
    brandFromSupplier: d.brandFromSupplier,
    mpnFromSku: d.mpnFromSku,
    defaultCondition: d.defaultCondition,
    includeOutOfStock: d.includeOutOfStock,
    acceptsReturns: d.acceptsReturns === 'unset' ? null : d.acceptsReturns === 'yes',
    returnWindowDays: d.returnWindowDays.trim() && days > 0 ? Math.min(days, 3650) : null,
    returnPolicyUrl: d.returnPolicyUrl,
    adsEligible: d.adsEligible,
  }
}

function when(iso: string | null): string {
  if (!iso) return 'never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? 'never' : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function ChatGptProductFeedSettingsTab() {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [format, setFormat] = useState<FeedFile>('products.csv')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewErr, setPreviewErr] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`)
      if (!res.ok) return
      const s = await res.json() as Settings
      setSaved(s)
      setDraft(draftOf(s))
    } catch { /* retry on next open */ }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Yield a microtask first so the opening setState never runs synchronously
    // inside the effect.
    void (async () => {
      await Promise.resolve()
      if (!cancelled) await load()
    })()
    return () => { cancelled = true }
  }, [load])

  const send = useCallback(async (method: 'PATCH' | 'POST', body: unknown, done: string) => {
    setBusy(true)
    setMsg('')
    setErr('')
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null) as (Settings & { error?: string }) | null
      if (!res.ok || !data) {
        setErr(data?.error ?? 'Could not save those settings.')
        return
      }
      // Re-seed from what was stored, not what was typed: an address the server
      // could not make sense of comes back empty rather than looking saved.
      setSaved(data)
      setDraft(draftOf(data))
      setMsg(done)
    } catch {
      setErr('Could not reach the site to save those settings.')
    } finally {
      setBusy(false)
    }
  }, [])

  const save = useCallback(() => {
    if (draft) void send('PATCH', bodyOf(draft), 'Saved.')
  }, [draft, send])

  const regenerate = useCallback(() => {
    if (!window.confirm('Make a new feed address? The current one stops working straight away, so ChatGPT will need the new one.')) return
    void send('POST', { action: 'regenerate-key' }, 'New address made. Give it to ChatGPT.')
  }, [send])

  const copy = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* the box is selectable as a fallback */ }
  }, [])

  const runPreview = useCallback(async () => {
    setPreviewBusy(true)
    setPreviewErr('')
    try {
      const res = await fetch(`${API_BASE}/preview`)
      const data = await res.json().catch(() => null) as (Preview & { error?: string }) | null
      if (!res.ok || !data) {
        setPreviewErr(data?.error ?? 'Could not build the feed.')
        return
      }
      setPreview(data)
    } catch {
      setPreviewErr('Could not reach the site to build the feed.')
    } finally {
      setPreviewBusy(false)
    }
  }, [])

  if (!saved || !draft) return <p className="field-hint">Loading…</p>

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value })
  const url = saved.feedUrls[format]

  return (
    <div>
      <p className="field-hint" style={{ marginBottom: '1rem' }}>
        Gives ChatGPT a product feed of your shop, in the format its merchant tools ask for. Every
        variation is its own product with its own price, photo and stock, grouped under its listing. The
        feed is built fresh each time it is collected, so it always matches the shop.
      </p>

      {saved.enabled && !saved.feedUrls['products.csv'] && (
        <div className="alert alert-warning">
          This site has no address set, so there is no feed address to hand out yet.
        </div>
      )}

      <SettingsHeaderActions>
        <SettingsHeaderStatus message={msg} error={err} />
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </SettingsHeaderActions>

      <div className="settings-cols">
        <div className="card">
          <div className="card-title">Feed address</div>
          <div className="field field--beside-input">
            <label className="settings-check">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              <span>Serve the product feed</span>
            </label>
            <p className="field-hint">Off, the address below answers &ldquo;not found&rdquo;.</p>
          </div>

          <div className="field">
            <label>
              Format
              <InfoTip>
                Plain CSV is the one OpenAI&rsquo;s own guides walk through. The compressed versions are smaller
                and are what its file specification prefers for large catalogues. Same products in each.
              </InfoTip>
            </label>
            <select value={format} onChange={(e) => setFormat(e.target.value as FeedFile)}>
              {FEED_FILES.map((file) => <option key={file} value={file}>{FORMAT_LABELS[file]}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Address to give ChatGPT</label>
            {url ? (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input type="text" readOnly value={url} onFocus={(e) => e.target.select()} style={{ flex: '1 1 320px', minWidth: 0 }} />
                <button type="button" className="btn" onClick={() => void copy(url)}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
            ) : (
              <p className="field-hint">Set the site&rsquo;s address first.</p>
            )}
            <p className="field-hint">
              Keep it to yourself: anyone with it can download your catalogue.{' '}
              <button type="button" className="btn btn-link" onClick={regenerate} disabled={busy} style={{ padding: 0 }}>
                Make a new address
              </button>
            </p>
          </div>

          <div className="field">
            <label>Last collected</label>
            <p className="field-hint" style={{ marginTop: 0 }}>
              {saved.lastFetchedAt
                ? <>{when(saved.lastFetchedAt)}, {saved.lastFetchedItems ?? 0} products{saved.lastFetchAgent ? <>, by <code>{saved.lastFetchAgent}</code></> : null}.</>
                : 'Not yet. It will show here once something downloads the feed.'}
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-title">What each product says</div>
          <div className="field">
            <label>
              Seller name
              <InfoTip>ChatGPT shows this as who is selling. Required on every product.</InfoTip>
            </label>
            <input
              type="text"
              value={draft.sellerName}
              placeholder={saved.effectiveSellerName ?? 'Your shop name'}
              onChange={(e) => set('sellerName', e.target.value)}
            />
            <p className="field-hint">Leave empty to use the site name.</p>
          </div>

          <div className="field">
            <label className="settings-check">
              <input type="checkbox" checked={draft.brandFromSupplier} onChange={(e) => set('brandFromSupplier', e.target.checked)} />
              <span>Use each product&rsquo;s supplier as its brand</span>
            </label>
          </div>
          <div className="field">
            <label>
              Brand when nothing else says
              <InfoTip>
                Brand is required. A product with no supplier and no brand here is left out of the feed rather
                than sent with a made-up one - the check below lists any.
              </InfoTip>
            </label>
            <input type="text" value={draft.defaultBrand} onChange={(e) => set('defaultBrand', e.target.value)} />
          </div>

          <div className="field">
            <label className="settings-check">
              <input type="checkbox" checked={draft.mpnFromSku} onChange={(e) => set('mpnFromSku', e.target.checked)} />
              <span>Send product codes as manufacturer part numbers</span>
              <InfoTip>Only tick this if your codes are the maker&rsquo;s own. If you number your own stock, leave it.</InfoTip>
            </label>
          </div>

          <div className="field">
            <label>Condition</label>
            <select value={draft.defaultCondition} onChange={(e) => set('defaultCondition', e.target.value as Condition)}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="settings-check">
              <input type="checkbox" checked={draft.includeOutOfStock} onChange={(e) => set('includeOutOfStock', e.target.checked)} />
              <span>Include products that are out of stock</span>
              <InfoTip>They are marked as out of stock. If the shop hides sold-out products, they stay hidden here too.</InfoTip>
            </label>
          </div>

          <div className="field">
            <label className="settings-check">
              <input type="checkbox" checked={draft.adsEligible} onChange={(e) => set('adsEligible', e.target.checked)} />
              <span>Offer products for ChatGPT adverts</span>
              <InfoTip>Marks every product as available to advertise. Leave it off if you are not running adverts there.</InfoTip>
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Returns</div>
          <div className="field">
            <label>Do you take returns?</label>
            <select value={draft.acceptsReturns} onChange={(e) => set('acceptsReturns', e.target.value as Draft['acceptsReturns'])}>
              <option value="unset">Don&rsquo;t say</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
            <p className="field-hint">Products marked as not returnable always say no, whatever this says.</p>
          </div>
          {draft.acceptsReturns === 'yes' && (
            <div className="field">
              <label>Days to return</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={draft.returnWindowDays}
                onChange={(e) => set('returnWindowDays', e.target.value)}
              />
            </div>
          )}
          <div className="field">
            <label>Returns policy page</label>
            <input
              type="url"
              value={draft.returnPolicyUrl}
              placeholder="https://"
              onChange={(e) => set('returnPolicyUrl', e.target.value)}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">Check the feed</div>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Builds the feed as ChatGPT would get it, from saved settings, and lists anything left out.
          </p>
          <button type="button" className="btn" onClick={() => void runPreview()} disabled={previewBusy}>
            {previewBusy ? 'Building…' : 'Check the feed'}
          </button>
          {previewErr && <div className="alert alert-danger" style={{ marginTop: '0.75rem' }}>{previewErr}</div>}
          {preview && (
            <div style={{ marginTop: '0.75rem' }}>
              <p>
                <strong>{preview.itemCount}</strong> products from <strong>{preview.groupCount}</strong> listings,
                sold by <strong>{preview.sellerName || 'nobody yet'}</strong>.
              </p>
              {preview.withheldCount > 0 ? (
                <>
                  <div className="alert alert-warning">
                    {preview.withheldCount} left out:{' '}
                    {(Object.keys(preview.withheldCounts) as Array<keyof Preview['withheldCounts']>)
                      .filter((reason) => preview.withheldCounts[reason] > 0)
                      .map((reason) => `${preview.withheldCounts[reason]} ${REASON_LABELS[reason].toLowerCase()}`)
                      .join(', ')}.
                  </div>
                  <ul style={{ maxHeight: 240, overflowY: 'auto', paddingLeft: '1.25rem', margin: 0 }}>
                    {preview.withheld.map((item) => (
                      <li key={item.id}>{item.title} <span className="field-hint">({REASON_LABELS[item.reason]})</span></li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="field-hint">Nothing left out.</p>
              )}
              {preview.sample.length > 0 && (
                <details style={{ marginTop: '0.75rem' }}>
                  <summary>First {preview.sample.length} products, as sent</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.8rem' }}>
                    {JSON.stringify(preview.sample, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
