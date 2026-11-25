import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import { useRef, useState } from 'react'

import { useMessage } from '../../components/message-context'

import { isSelectableReleaseFile, releasePickerOptions } from './release-files'

type OpenFilePicker = (
  options: ReturnType<typeof releasePickerOptions>,
) => Promise<{ getFile(): Promise<File> }[]>

export function PackageUpload({
  label,
  platform,
  accept,
  version,
  expectedName,
  disabled,
  onFile,
}: {
  label: string
  platform: string
  accept: string
  version: string
  expectedName?: string
  disabled: boolean
  onFile: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const directoryRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [useStandardInput, setUseStandardInput] = useState(false)
  const [matches, setMatches] = useState<File[] | null>(null)
  const message = useMessage()
  const description = platform + ' ' + label
  const compatible = (name: string) =>
    isSelectableReleaseFile(name, accept, version, expectedName)
  const close = () => {
    setOpen(false)
    setMatches(null)
  }
  const take = (file: File) => {
    if (!compatible(file.name)) {
      message.error(
        expectedName
          ? '请选择与更新文件配套的 ' + expectedName
          : '请选择 v' +
              version.trim().replace(/^v/, '') +
              ' 的 ' +
              accept +
              ' 文件',
      )
      return
    }
    close()
    onFile(file)
  }

  const chooseSingleFile = async () => {
    const host = window as Window & { showOpenFilePicker?: OpenFilePicker }
    if (useStandardInput || !host.isSecureContext || !host.showOpenFilePicker) {
      inputRef.current?.click()
      return
    }
    try {
      const [handle] = await host.showOpenFilePicker(
        releasePickerOptions(accept, description),
      )
      if (handle) take(await handle.getFile())
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      if (
        err instanceof Error &&
        (err.name === 'SecurityError' ||
          err.name === 'NotAllowedError' ||
          err.name === 'NotSupportedError')
      ) {
        // Opening another picker after the await may lose user activation.
        setUseStandardInput(true)
        message.info(
          '此浏览器未开放严格文件选择器。请从文件夹筛选，或再次选择单个文件。',
        )
      } else {
        message.error('未能读取所选文件，请重新选择。')
      }
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outlined"
        className="package-upload"
        disabled={disabled}
        aria-label={description}
        startIcon={<CloudUploadOutlined />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        fullWidth
        maxWidth="sm"
        aria-label={description}
      >
        <DialogTitle>{description}</DialogTitle>
        <DialogContent>
          <p>
            {expectedName
              ? '配套签名：' + expectedName
              : '版本 ' + version + ' · ' + accept}
          </p>
          <div className="row-form">
            {typeof HTMLInputElement !== 'undefined' &&
              'webkitdirectory' in HTMLInputElement.prototype && (
                <Button
                  variant="contained"
                  onClick={() => directoryRef.current?.click()}
                >
                  从文件夹筛选
                </Button>
              )}
            <Button variant="outlined" onClick={() => void chooseSingleFile()}>
              选择单个文件
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={accept}
            aria-label={description + '：选择单个文件'}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (f) take(f)
            }}
          />
          <input
            ref={directoryRef}
            type="file"
            hidden
            multiple
            {...{ webkitdirectory: '' }}
            aria-label={description + '：选择文件夹'}
            onChange={(e) => {
              setMatches(
                Array.from(e.currentTarget.files ?? []).filter((f) =>
                  compatible(f.name),
                ),
              )
              e.currentTarget.value = ''
            }}
          />
          {matches &&
            (matches.length ? (
              <List aria-label="匹配的文件">
                {matches.map((f) => (
                  <ListItemButton
                    key={f.webkitRelativePath}
                    onClick={() => take(f)}
                  >
                    <ListItemText
                      primary={f.name}
                      secondary={f.webkitRelativePath}
                    />
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <p>此文件夹没有匹配的文件。</p>
            ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>取消</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
