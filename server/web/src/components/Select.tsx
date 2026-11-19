import MenuItem from '@mui/material/MenuItem'
import MuiSelect from '@mui/material/Select'
import { useRef, useState } from 'react'

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
  const triggerRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState({ above: false, height: 280, width: 0 })
  const placeMenu = () => {
    const box = triggerRef.current?.getBoundingClientRect()
    if (!box) return
    const below = window.innerHeight - box.bottom - 20
    const above = box.top - 20
    const openAbove =
      below < Math.min(280, options.length * 48 + 16) && above > below
    setMenu({
      above: openAbove,
      height: Math.max(0, Math.min(280, openAbove ? above : below)),
      width: box.width,
    })
  }

  return (
    <MuiSelect
      ref={triggerRef}
      fullWidth
      size="small"
      displayEmpty
      value={value}
      inputProps={{ 'aria-label': label }}
      disabled={disabled}
      onOpen={placeMenu}
      onChange={(event) => onChange(event.target.value)}
      MenuProps={{
        anchorOrigin: {
          vertical: menu.above ? 'top' : 'bottom',
          horizontal: 'left',
        },
        transformOrigin: {
          vertical: menu.above ? 'bottom' : 'top',
          horizontal: 'left',
        },
        slotProps: {
          paper: {
            sx: {
              mt: menu.above ? -0.5 : 0.5,
              maxHeight: menu.height,
              width: menu.width,
            },
          },
        },
      }}
    >
      {options.map((option) => (
        <MenuItem
          value={option.value}
          key={option.value}
          sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
        >
          {option.label}
        </MenuItem>
      ))}
    </MuiSelect>
  )
}
