import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

import './Select.css'

type SelectProps = {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
  disabled?: boolean
}

export function Select({
  value,
  onChange,
  options,
  label,
  disabled,
}: SelectProps) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef({ text: '', time: 0 })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = options.findIndex((option) => option.value === value)
  const expanded = open && !disabled

  useLayoutEffect(() => {
    if (!expanded) return
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect || !listRef.current) return
      const below = window.innerHeight - rect.bottom - 14
      const above = rect.top - 14
      const upwards =
        below < Math.min(280, options.length * 38 + 8) && above > below
      const width = Math.min(rect.width, window.innerWidth - 16)
      Object.assign(listRef.current.style, {
        left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
        width: `${width}px`,
        maxHeight: `${Math.max(0, Math.min(280, upwards ? above : below))}px`,
        bottom: upwards ? `${window.innerHeight - rect.top + 6}px` : 'auto',
        top: upwards ? 'auto' : `${rect.bottom + 6}px`,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [expanded, options.length])

  useLayoutEffect(() => {
    if (!expanded) return
    const frame = requestAnimationFrame(() => {
      const option = listRef.current?.children[active] as
        | HTMLElement
        | undefined
      if (!option || !listRef.current) return
      const menu = listRef.current
      if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
      else if (
        option.offsetTop + option.offsetHeight >
        menu.scrollTop + menu.clientHeight
      ) {
        menu.scrollTop =
          option.offsetTop + option.offsetHeight - menu.clientHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, expanded])

  useEffect(() => {
    if (!expanded) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [expanded])

  function choose(index: number) {
    onChange(options[index].value)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || !options.length) return
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (expanded) choose(active)
      else {
        setActive(Math.max(0, selected))
        setOpen(true)
      }
      return
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const current = expanded ? active : Math.max(0, selected)
      setActive(
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : !expanded
              ? current
              : Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    current + (event.key === 'ArrowDown' ? 1 : -1),
                  ),
                ),
      )
      setOpen(true)
      return
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault()
      const now = Date.now()
      const text =
        (now - searchRef.current.time < 700 ? searchRef.current.text : '') +
        event.key.toLocaleLowerCase()
      searchRef.current = { text, time: now }
      const prefix = [...text].every((char) => char === text[0])
        ? text[0]
        : text
      const start = expanded ? active : selected
      const indexes = options.map(
        (_, index) =>
          (Math.max(0, start) + index + (prefix.length === 1 ? 1 : 0)) %
          options.length,
      )
      const match = indexes.find((index) =>
        options[index].label.toLocaleLowerCase().startsWith(prefix),
      )
      if (match !== undefined) {
        setActive(match)
        if (!expanded) onChange(options[match].value)
      }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="ops-select-trigger"
        aria-label={label}
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-controls={expanded ? id : undefined}
        aria-activedescendant={expanded ? `${id}-${active}` : undefined}
        disabled={disabled || !options.length}
        title={options[selected]?.label}
        onClick={() => {
          triggerRef.current?.focus()
          setActive(Math.max(0, selected))
          searchRef.current = { text: '', time: 0 }
          setOpen(!expanded)
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKey}
      >
        <span className="ops-select-value">
          {options[selected]?.label ?? ''}
        </span>
        <span className="ops-select-arrow" aria-hidden="true" />
      </button>
      {expanded &&
        createPortal(
          <div
            ref={listRef}
            id={id}
            role="listbox"
            aria-label={label}
            className="ops-select-list"
            onPointerDown={(event) => event.preventDefault()}
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`ops-select-option${active === index ? ' ops-select-active' : ''}`}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
                title={option.label}
              >
                {option.label}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
