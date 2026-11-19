import AddRounded from '@mui/icons-material/AddRounded'
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { ReactNode } from 'react'

export const PHONE_LAYOUT_QUERY = '(max-width: 760px)'

export function CreateFormSection({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const phone = useMediaQuery(PHONE_LAYOUT_QUERY)
  if (!phone) return children

  return (
    <Accordion variant="outlined" disableGutters className="phone-create">
      <AccordionSummary expandIcon={<ExpandMoreRounded />}>
        <AddRounded fontSize="small" />
        {label}
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  )
}
