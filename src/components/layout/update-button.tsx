import { Button } from '@mui/material'
import { useRef } from 'react'

import { DialogRef } from '@/components/base'
import { isCompanyUpdate, useUpdate } from '@/hooks/use-update'

import { CompanyUpdateViewer } from '../setting/mods/company-update-viewer'
import { UpdateViewer } from '../setting/mods/update-viewer'

interface Props {
  className?: string
}

export const UpdateButton = (props: Props) => {
  const { className } = props
  const viewerRef = useRef<DialogRef>(null)

  const { updateInfo } = useUpdate()

  if (!updateInfo?.available) return null

  if (isCompanyUpdate(updateInfo)) {
    return (
      <>
        <CompanyUpdateViewer ref={viewerRef} />

        <Button
          color="error"
          variant="contained"
          size="small"
          className={className}
          onClick={() => viewerRef.current?.open()}
        >
          New
        </Button>
      </>
    )
  }

  return (
    <>
      <UpdateViewer ref={viewerRef} />

      <Button
        color="error"
        variant="contained"
        size="small"
        className={className}
        onClick={() => viewerRef.current?.open()}
      >
        New
      </Button>
    </>
  )
}
