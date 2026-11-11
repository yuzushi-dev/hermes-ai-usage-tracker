/**
 * AI Usage Tracker — live subscription quota tracker with granular sub-quota
 * windows (AGY Gemini/Argon/Claude, Claude Fable, Codex, Mistral) and Orca ADE
 * style multi-chip status bar.
 *
 * Scope: subscription quota windows, granular sub-quotas, per profile, in the Hermes desktop.
 * Backend: ~/.hermes/plugins/ai-usage-tracker/dashboard/plugin_api.py
 */
import {
  Badge,
  Button,
  Codicon,
  EmptyState,
  ErrorState,
  ROUTES_AREA,
  STATUSBAR_AREAS,
  SIDEBAR_NAV_AREA,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  atom,
  cn,
  haptic,
  host,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useState } from 'react'

const ID = 'ai-usage-tracker'
const ROUTE = '/ai-usage'
const REFRESH_PAGE_MS = 120_000
const REFRESH_CHIP_MS = 180_000

let rest = null
let storage = null
let pendingRefresh = false

// Providers the user has hidden — plugin-scoped, shared by page and chip.
const HIDDEN_KEY = 'hidden-providers-v1'
const $hidden = atom([])

// Selected profile — plugin-scoped, shared by page and chip. Empty means "current server profile".
const PROFILE_KEY = 'selected-profile-v1'
const $profile = atom('')

// Status bar display mode: 'multi' (Orca ADE style badges side-by-side) or 'single' (one worst or pinned).
const CHIP_MODE_KEY = 'chip-mode-v2'
const $chipMode = atom('multi')

// Pinned providers list for status bar multi-badge mode.
const CHIP_PINNED_KEY = 'chip-pinned-list-v2'
const $pinnedList = atom([])

// Which provider the status-bar chip watches in single mode ('auto' or provider id).
const CHIP_KEY = 'chip-provider-v1'
const AUTO_CHIP = 'auto'
const $chipProvider = atom('')

const DEFAULT_FAVORITES = [
  'antigravity-agy-argon',
  'antigravity-agy-gemini',
  'antigravity-agy-claude',
  'anthropic',
  'claude-fable',
  'openai-codex'
]

function selectChipMode(mode) {
  const value = String(mode || 'multi')
  $chipMode.set(value)
  try {
    storage?.set(CHIP_MODE_KEY, value)
  } catch {
    /* fallback to in-memory */
  }
}

function selectChipProvider(id) {
  const value = String(id || '')
  $chipProvider.set(value)
  try {
    storage?.set(CHIP_KEY, value)
  } catch {
    /* fallback to in-memory */
  }
}

function togglePinned(id) {
  const current = $pinnedList.get()
  const exists = current.includes(id)
  const next = exists ? current.filter(x => x !== id) : [...current, id]
  $pinnedList.set(next)
  try {
    storage?.set(CHIP_PINNED_KEY, next)
  } catch {
    /* fallback to in-memory */
  }
}

function persistHidden(ids) {
  $hidden.set(ids)
  try {
    storage?.set(HIDDEN_KEY, ids)
  } catch {
    /* fallback to in-memory */
  }
}

function hideProvider(id) {
  const current = $hidden.get()
  if (!current.includes(id)) persistHidden([...current, id])
}

function unhideProvider(id) {
  persistHidden($hidden.get().filter(value => value !== id))
}

function unhideAll() {
  persistHidden([])
}

function selectProfile(name) {
  const value = String(name || '')
  $profile.set(value)
  try {
    storage?.set(PROFILE_KEY, value)
  } catch {
    /* fallback to in-memory */
  }
}

// ---------------------------------------------------------------- formatters

function fmtLocal(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return (
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ', ' +
    d.toLocaleDateString([], { day: '2-digit', month: 'short' })
  )
}

function resetLabel(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const seconds = Math.round((d.getTime() - Date.now()) / 1000)
  if (seconds <= 0) return 'resets now'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rel = days
    ? `in ${days}d ${hours}h`
    : hours
      ? `in ${hours}h ${minutes}m`
      : `in ${minutes}m`
  return `resets ${rel} (${fmtLocal(iso)})`
}

function pct(value) {
  if (value === null || value === undefined) return '—'
  return `${Math.round(Number(value))}%`
}

function toneFor(remaining) {
  if (remaining === null || remaining === undefined) return 'muted'
  if (remaining <= 5) return 'bad'
  if (remaining <= 25) return 'warn'
  return 'good'
}

function statusOf(provider) {
  if (provider.quota?.available) return { variant: 'success', label: 'live quota' }
  if (provider.quota?.unavailable_reason) return { variant: 'muted', label: 'no quota' }
  return { variant: 'muted', label: 'unavailable' }
}

function profileLabel(row) {
  if (!row) return 'profile'
  return `${row.name}${row.is_default ? ' · default' : ''}${row.gateway_running ? ' · up' : ''}`
}

function compactLabel(provider) {
  const id = provider?.id || ''
  if (id === 'antigravity-agy-argon') return 'Argon'
  if (id === 'antigravity-agy-gemini') return 'Gemini'
  if (id === 'antigravity-agy-claude') return 'AGY Claude'
  if (id === 'claude-fable') return 'Fable'
  if (id === 'anthropic' || id === 'claude-subscription-directsdk-experimental') return 'Claude'
  if (id === 'openai-codex') return 'Codex'
  if (id.includes('mistral')) return 'Mistral'
  return (provider?.label || id).replace(/^(AGY|Google|OpenAI|GitHub)\s*/i, '')
}

/** One provider's tightest numeric window, or null when it reports none. */
function worstWindowOf(provider) {
  let worst = null
  for (const window of provider?.quota?.windows || []) {
    const remaining = window.remaining_percent
    if (remaining === null || remaining === undefined) continue
    if (worst === null || remaining < worst.remaining) {
      worst = {
        remaining,
        provider: provider.label,
        window: window.label,
        reset_at: window.reset_at || null
      }
    }
  }
  return worst
}

/** AUTO pick: the tightest window across every provider that isn't hidden. */
function worstRemaining(payload, hiddenIds) {
  const hidden = hiddenIds || []
  let worst = null
  for (const provider of payload?.providers || []) {
    if (hidden.includes(provider.id)) continue
    const candidate = worstWindowOf(provider)
    if (candidate && (worst === null || candidate.remaining < worst.remaining)) worst = candidate
  }
  return worst
}

// ---------------------------------------------------------------- data hooks

function usagePath(profile, refresh) {
  const params = []
  if (profile) params.push(`profile=${encodeURIComponent(profile)}`)
  if (refresh) params.push('refresh=1')
  return params.length ? `/usage?${params.join('&')}` : '/usage'
}

function useUsage(profile, intervalMs) {
  return useQuery({
    queryKey: ['ai-usage-tracker', 'usage', profile || 'server'],
    queryFn: () => {
      const refresh = pendingRefresh
      pendingRefresh = false
      return rest(usagePath(profile, refresh))
    },
    refetchInterval: intervalMs,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: 1,
    placeholderData: previous => previous
  })
}

// ---------------------------------------------------------------- components

function QuotaBar({ window }) {
  const remaining = window.remaining_percent
  if (remaining === null || remaining === undefined) {
    return jsxs('div', {
      className: 'flex items-baseline gap-2 text-xs',
      children: [
        jsx('span', { className: 'w-36 shrink-0 text-(--ui-text-tertiary)', children: window.label }),
        jsx('span', { className: 'text-(--ui-text-quaternary)', children: window.detail || 'unlimited' })
      ]
    })
  }
  const tone = toneFor(remaining)
  return jsxs('div', {
    className: 'flex flex-col gap-1',
    children: [
      jsxs('div', {
        className: 'flex flex-wrap items-baseline gap-2 text-xs',
        children: [
          jsx('span', { className: 'w-36 shrink-0 font-medium text-(--ui-text-secondary)', children: window.label }),
          jsx('span', {
            className: cn(
              'font-semibold tabular-nums',
              remaining <= 5
                ? 'text-(--ui-accent)'
                : remaining <= 25
                  ? 'text-amber-500'
                  : 'text-(--ui-text-primary)'
            ),
            children: `${pct(remaining)} left`
          }),
          window.detail ? jsx('span', { className: 'text-(--ui-text-quaternary)', children: `(${window.detail})` }) : null,
          resetLabel(window.reset_at)
            ? jsx('span', { className: 'text-(--ui-text-quaternary)', children: resetLabel(window.reset_at) })
            : null,
          tone === 'bad' || tone === 'warn'
            ? jsx(Badge, {
                variant: tone === 'bad' ? 'destructive' : 'warn',
                size: 'xs',
                children: tone === 'bad' ? 'low' : 'watch'
              })
            : null
        ]
      }),
      jsx('div', {
        className: 'h-1.5 w-full overflow-hidden rounded-[2px]',
        style: { background: 'var(--ui-stroke-secondary)' },
        children: jsx('div', {
          className: 'h-full rounded-[2px] transition-all',
          style: {
            width: `${Math.max(1, Math.min(100, remaining))}%`,
            background:
              tone === 'bad'
                ? 'var(--ui-accent)'
                : tone === 'warn'
                  ? '#f59e0b'
                  : '#10b981'
          }
        })
      })
    ]
  })
}

function ProviderCard({ provider, isHidden, isPinned, onTogglePin }) {
  const status = statusOf(provider)
  const windows = provider.quota?.windows || []
  const details = provider.quota?.details || []

  return jsxs('div', {
    className: cn(
      'flex flex-col gap-2 rounded-[5px] border border-(--ui-stroke-secondary) p-3 transition-colors',
      isHidden && 'opacity-60',
      isPinned && 'ring-1 ring-(--ui-stroke-primary)'
    ),
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('span', { className: 'text-sm font-semibold', children: provider.label }),
          provider.quota?.plan
            ? jsx(Badge, { variant: 'muted', size: 'xs', children: provider.quota.plan })
            : null,
          jsx(Badge, { variant: status.variant, size: 'xs', children: status.label }),
          provider.active
            ? jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: 'active' })
            : null,
          jsx('span', { className: 'flex-1' }),
          // Pin button for status bar
          jsx('button', {
            type: 'button',
            title: isPinned ? 'Unpin from status bar' : 'Pin to status bar (Orca ADE mode)',
            'aria-label': isPinned ? `Unpin ${provider.label}` : `Pin ${provider.label}`,
            className: cn(
              'shrink-0 px-1 text-xs transition-colors',
              isPinned
                ? 'text-amber-500 font-bold'
                : 'text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)'
            ),
            onClick: () => {
              haptic('tap')
              onTogglePin(provider.id)
            },
            children: jsx(Codicon, { name: isPinned ? 'pinned' : 'pin' })
          }),
          // Hide button
          jsx('button', {
            type: 'button',
            title: isHidden ? 'Show this provider again' : 'Hide this provider',
            'aria-label': isHidden ? `Unhide ${provider.label}` : `Hide ${provider.label}`,
            className: 'shrink-0 px-1 text-(--ui-text-quaternary) hover:text-(--ui-text-secondary)',
            onClick: () => {
              haptic('tap')
              if (isHidden) unhideProvider(provider.id)
              else hideProvider(provider.id)
            },
            children: jsx(Codicon, { name: isHidden ? 'eye' : 'close' })
          })
        ]
      }),
      windows.map((window, index) => jsx(QuotaBar, { window }, index)),
      !provider.quota?.available && provider.quota?.unavailable_reason
        ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: provider.quota.unavailable_reason })
        : null,
      details.map((detail, index) =>
        jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: detail }, index)
      )
    ]
  })
}

function ProfilePicker({ profiles, value, onSelect }) {
  if (!profiles.length) return null
  return jsxs(Select, {
    value: value || undefined,
    onValueChange: onSelect,
    children: [
      jsx(SelectTrigger, {
        className: 'h-6 w-40 text-[0.6875rem]',
        'aria-label': 'Hermes profile',
        children: jsx(SelectValue, { placeholder: 'profile…' })
      }),
      jsx(SelectContent, {
        children: profiles.map(row => jsx(SelectItem, { value: row.name, children: profileLabel(row) }, row.name))
      })
    ]
  })
}

function ChipModePicker({ mode, onSelect }) {
  return jsxs(Select, {
    value: mode,
    onValueChange: onSelect,
    children: [
      jsx(SelectTrigger, {
        className: 'h-6 w-48 text-[0.6875rem]',
        title: 'Status bar display style',
        'aria-label': 'Status bar display mode',
        children: jsx(SelectValue, {})
      }),
      jsx(SelectContent, {
        children: [
          jsx(SelectItem, { value: 'multi', children: 'Multi-Badge (Orca ADE)' }),
          jsx(SelectItem, { value: 'single', children: 'Single Badge (Compact)' })
        ]
      })
    ]
  })
}

function SingleChipPicker({ providers, value, onSelect }) {
  return jsxs(Select, {
    value: value || AUTO_CHIP,
    onValueChange: next => {
      haptic('tap')
      onSelect(next === AUTO_CHIP ? '' : next)
    },
    children: [
      jsx(SelectTrigger, {
        className: 'h-6 w-48 text-[0.6875rem]',
        title: 'Which provider the single chip shows',
        'aria-label': 'Single chip provider',
        children: jsx(SelectValue, {})
      }),
      jsx(SelectContent, {
        children: [
          jsx(SelectItem, { value: AUTO_CHIP, children: 'Auto (Lowest %)' }),
          ...providers.map(provider =>
            jsx(SelectItem, { value: provider.id, children: provider.label }, provider.id)
          )
        ]
      })
    ]
  })
}

function PageHeader({
  profiles,
  profile,
  setProfile,
  chipMode,
  setChipMode,
  chipProviders,
  chipProvider,
  setChipProvider,
  isFetching,
  refetch,
  meta,
  hiddenCount,
  showHidden,
  setShowHidden
}) {
  return jsxs('div', {
    className: 'flex flex-wrap items-center gap-2',
    children: [
      jsx('span', { className: 'text-sm font-semibold', children: 'AI Quota Tracker' }),
      jsx('span', {
        className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
        children: meta || ''
      }),
      jsx('span', { className: 'flex-1' }),
      hiddenCount > 0
        ? jsxs(Button, {
            variant: 'ghost',
            title: showHidden ? 'Hide the hidden providers again' : `Show ${hiddenCount} hidden provider(s)`,
            onClick: () => {
              haptic('tap')
              setShowHidden(!showHidden)
            },
            children: [
              jsx(Codicon, { name: 'eye' }),
              jsx('span', { children: showHidden ? `Showing hidden ${hiddenCount}` : `Hidden ${hiddenCount}` })
            ]
          })
        : null,
      showHidden && hiddenCount > 0
        ? jsx(Button, {
            variant: 'text',
            onClick: () => {
              haptic('tap')
              unhideAll()
            },
            children: 'Unhide all'
          })
        : null,
      jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: 'Status bar:' }),
      jsx(ChipModePicker, { mode: chipMode, onSelect: setChipMode }),
      chipMode === 'single'
        ? jsx(SingleChipPicker, { providers: chipProviders, value: chipProvider, onSelect: setChipProvider })
        : null,
      jsx(ProfilePicker, { profiles, value: profile, onSelect: setProfile }),
      jsxs(Button, {
        variant: 'secondary',
        onClick: () => {
          haptic('tap')
          pendingRefresh = true
          refetch()
        },
        disabled: isFetching,
        children: [
          jsx(Codicon, { name: 'refresh' }),
          jsx('span', { children: isFetching ? 'Refreshing…' : 'Refresh' })
        ]
      })
    ]
  })
}

function UsagePage() {
  const [showHidden, setShowHidden] = useState(false)
  const hiddenIds = useValue($hidden)
  const selected = useValue($profile)
  const chipMode = useValue($chipMode)
  const chipProvider = useValue($chipProvider)
  const pinnedList = useValue($pinnedList)
  const { data, error, isFetching, refetch } = useUsage(selected, REFRESH_PAGE_MS)

  const profiles = data?.profiles || []
  const shownProfile = selected || data?.profile || ''
  const providers = data?.providers || []
  const visible = providers.filter(provider => !hiddenIds.includes(provider.id))
  const hiddenProviders = providers.filter(provider => hiddenIds.includes(provider.id))
  const live = visible.filter(provider => provider.quota?.available).length

  const header = jsx(PageHeader, {
    profiles,
    profile: shownProfile,
    setProfile: selectProfile,
    chipMode,
    setChipMode: selectChipMode,
    chipProviders: visible,
    chipProvider,
    setChipProvider: selectChipProvider,
    isFetching,
    refetch,
    hiddenCount: hiddenIds.length,
    showHidden,
    setShowHidden,
    meta: data ? `probed in ${data.probe_seconds}s (${fmtLocal(data.generated_at)})` : null
  })

  if (error && !data) {
    return jsxs('div', {
      className: 'flex flex-col gap-3 p-4',
      children: [
        header,
        jsx(ErrorState, {
          title: 'Could not load quota data',
          description: `${error?.message || error}`,
          children: jsx(Button, { variant: 'secondary', onClick: () => refetch(), children: 'Retry' })
        })
      ]
    })
  }

  if (!data) {
    return jsxs('div', {
      className: 'flex flex-col gap-3 p-4',
      children: [
        header,
        jsx(Skeleton, { className: 'h-6 w-48' }),
        jsx(Skeleton, { className: 'h-24 w-full' }),
        jsx(Skeleton, { className: 'h-24 w-full' })
      ]
    })
  }

  return jsxs(ScrollArea, {
    className: 'h-full',
    children: jsxs('div', {
      className: 'flex flex-col gap-3 p-4',
      children: [
        header,
        error && data
          ? jsx('div', {
              className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
              children: `Showing last good snapshot — refresh failed: ${error?.message || error}`
            })
          : null,
        jsx('div', {
          className: 'text-[0.6875rem] text-(--ui-text-quaternary)',
          children: `${providers.length} provider(s) · ${live} reporting live quota · Click the pin icon on any card to toggle its status bar badge.`
        }),
        jsx(Separator, {}),
        jsxs('div', {
          className: 'flex flex-col gap-2.5',
          children: [
            visible.map(provider =>
              jsx(
                ProviderCard,
                {
                  provider,
                  isPinned: pinnedList.length > 0
                    ? pinnedList.includes(provider.id)
                    : DEFAULT_FAVORITES.includes(provider.id),
                  onTogglePin: togglePinned
                },
                provider.id
              )
            ),
            showHidden
              ? hiddenProviders.map(provider =>
                  jsx(
                    ProviderCard,
                    {
                      provider,
                      isHidden: true,
                      isPinned: false,
                      onTogglePin: togglePinned
                    },
                    `hidden-${provider.id}`
                  )
                )
              : null,
            visible.length === 0
              ? jsx(EmptyState, {
                  title: providers.length ? 'Every provider is hidden' : 'No providers detected',
                  description: providers.length
                    ? 'Use "Showing hidden" above to restore them.'
                    : 'Configure credentials for Antigravity, Claude, Codex, or Mistral.'
                })
              : null
          ]
        })
      ]
    })
  })
}

function UsageChip() {
  const hiddenIds = useValue($hidden)
  const selected = useValue($profile)
  const chipMode = useValue($chipMode)
  const pinnedId = useValue($chipProvider)
  const pinnedList = useValue($pinnedList)
  const { data } = useUsage(selected, REFRESH_CHIP_MS)

  const visible = (data?.providers || []).filter(provider => !(hiddenIds || []).includes(provider.id))

  // Single badge mode
  if (chipMode === 'single') {
    const pinned = pinnedId ? visible.find(provider => provider.id === pinnedId) : null
    const worst = (pinned ? worstWindowOf(pinned) : null) || worstRemaining(data, hiddenIds)
    const tone = toneFor(worst ? worst.remaining : null)
    const detail = worst
      ? [worst.provider, worst.window ? `${worst.window} window` : null, resetLabel(worst.reset_at)]
          .filter(Boolean)
          .join(' · ')
      : 'AI usage'

    return jsx('button', {
      type: 'button',
      title: `${detail}${pinned ? ' (pinned)' : ''} · Click to open dashboard`,
      'aria-label': `AI usage: ${detail}`,
      className: 'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
      onClick: () => {
        haptic('tap')
        host.navigate(ROUTE)
      },
      children: jsxs('span', {
        className: 'inline-flex items-center gap-1.5',
        children: [
          jsx('span', {
            'aria-hidden': true,
            className: 'inline-block size-1.5 rounded-full',
            style: {
              background:
                tone === 'bad'
                  ? 'var(--ui-accent)'
                  : tone === 'warn'
                    ? '#f59e0b'
                    : '#10b981'
            }
          }),
          jsx('span', {
            children: worst ? `${pct(worst.remaining)} · ${compactLabel({ id: pinnedId, label: worst.provider })}` : data ? 'AI Quota' : 'AI Quota…'
          })
        ]
      })
    })
  }

  // Multi-badge mode (Orca ADE style)
  const activeTargets =
    pinnedList.length > 0
      ? visible.filter(p => pinnedList.includes(p.id))
      : visible.filter(p => DEFAULT_FAVORITES.includes(p.id))

  const items = activeTargets.length > 0 ? activeTargets : visible.filter(p => p.quota?.available)

  if (!items.length) {
    return jsx('button', {
      type: 'button',
      className: 'px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
      onClick: () => {
        haptic('tap')
        host.navigate(ROUTE)
      },
      children: jsx('span', { children: data ? 'AI Quota' : 'AI Quota…' })
    })
  }

  return jsx('button', {
    type: 'button',
    title: 'Click to open AI Quota dashboard',
    className: 'inline-flex items-center gap-2 px-1 text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-text-secondary)',
    onClick: () => {
      haptic('tap')
      host.navigate(ROUTE)
    },
    children: items.map(provider => {
      const worst = worstWindowOf(provider)
      const tone = toneFor(worst ? worst.remaining : null)
      const label = compactLabel(provider)
      const pctText = worst ? pct(worst.remaining) : '—'
      const tooltip = worst
        ? `${provider.label}: ${worst.window || 'Window'} (${pctText} left) · ${resetLabel(worst.reset_at) || 'resets soon'}`
        : `${provider.label}`

      return jsxs(
        'span',
        {
          title: tooltip,
          className:
            'inline-flex items-center gap-1 px-1 py-0.5 rounded transition-colors hover:bg-(--ui-bg-secondary)',
          children: [
            jsx('span', {
              'aria-hidden': true,
              className: 'inline-block size-1.5 rounded-full shrink-0',
              style: {
                background:
                  tone === 'bad'
                    ? 'var(--ui-accent)'
                    : tone === 'warn'
                      ? '#f59e0b'
                      : '#10b981'
              }
            }),
            jsx('span', { className: 'tabular-nums font-medium', children: pctText }),
            jsx('span', { className: 'text-(--ui-text-quaternary) text-[0.625rem]', children: label })
          ]
        },
        provider.id
      )
    })
  })
}

export default {
  id: ID,
  name: 'AI Quota Tracker',
  register(ctx) {
    rest = ctx.rest
    storage = ctx.storage

    try {
      const saved = storage?.get(HIDDEN_KEY, [])
      if (Array.isArray(saved)) $hidden.set(saved.filter(value => typeof value === 'string'))
    } catch {
      /* ignore storage read error */
    }

    try {
      const savedMode = storage?.get(CHIP_MODE_KEY, 'multi')
      if (typeof savedMode === 'string') $chipMode.set(savedMode)
    } catch {
      /* ignore */
    }

    try {
      const savedPinned = storage?.get(CHIP_PINNED_KEY, [])
      if (Array.isArray(savedPinned)) $pinnedList.set(savedPinned.filter(v => typeof v === 'string'))
    } catch {
      /* ignore */
    }

    try {
      const savedChip = storage?.get(CHIP_KEY, '')
      if (typeof savedChip === 'string') $chipProvider.set(savedChip)
    } catch {
      /* ignore */
    }

    try {
      const savedProfile = storage?.get(PROFILE_KEY, '')
      if (typeof savedProfile === 'string' && savedProfile) {
        $profile.set(savedProfile)
      } else {
        const active = host.state.profile?.get?.()
        if (typeof active === 'string' && active) $profile.set(active)
      }
    } catch {
      /* ignore */
    }

    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: ROUTE },
      render: () => jsx(UsagePage, {})
    })

    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: ROUTE, label: 'AI Quotas', codicon: 'graph' }
    })

    ctx.register({
      id: 'chip',
      area: STATUSBAR_AREAS.right,
      order: 125,
      render: () => jsx(UsageChip, {})
    })
  }
}
