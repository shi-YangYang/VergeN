import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'

import { downloadAdminPackage, type PackageFile } from '../../api'
import { useMessage, alertContext } from '../../components/message-context'

import { PLATFORM_LABELS } from './platforms'

export function ReleaseFileLibrary({
  packages,
  busy,
  loading,
  removePackage,
}: {
  packages: PackageFile[]
  busy: boolean
  loading: boolean
  removePackage: (item: PackageFile) => Promise<void>
}) {
  const message = useMessage()
  return (
    <Paper
      component="section"
      variant="outlined"
      className="panel release-files"
    >
      <div className="release-section-heading">
        <h2>已上传文件</h2>
        <span className="muted">{packages.length} 个文件</span>
      </div>
      <div className="package-table">
        <Table className="mobile-cards">
          <TableHead>
            <TableRow>
              <TableCell>文件名</TableCell>
              <TableCell>平台 / 用途</TableCell>
              <TableCell>大小</TableCell>
              <TableCell>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {packages.map((item) => (
              <TableRow key={item.name}>
                <TableCell data-label="文件名">
                  <Button
                    variant="outlined"
                    type="button"
                    onClick={() =>
                      void downloadAdminPackage(item.name).catch((err) =>
                        message.error(alertContext(err)),
                      )
                    }
                  >
                    {item.name}
                  </Button>
                </TableCell>
                <TableCell data-label="平台 / 用途">
                  {PLATFORM_LABELS[item.platform]} ·{' '}
                  {item.kind === 'updater' ? '更新包' : '安装包'}
                </TableCell>
                <TableCell data-label="大小">{item.size}</TableCell>
                <TableCell data-label="操作" className="actions">
                  <div className="action-buttons">
                    <Button
                      variant="outlined"
                      color="error"
                      type="button"
                      disabled={!!busy}
                      onClick={() => void removePackage(item)}
                    >
                      删除文件
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!packages.length && (
              <TableRow>
                <TableCell colSpan={4} className="muted">
                  {loading ? '加载中…' : '暂无文件。'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Paper>
  )
}
