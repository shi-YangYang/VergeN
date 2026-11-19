import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'media' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#165c95', dark: '#104777', contrastText: '#ffffff' },
        background: { default: '#f3f8fd', paper: '#ffffff' },
        text: { primary: '#15324c', secondary: '#486379' },
        divider: '#cfdfed',
      },
    },
    dark: {
      palette: {
        primary: { main: '#99d5ff', dark: '#75b9ed', contrastText: '#0d2942' },
        background: { default: '#101e2b', paper: '#192c3c' },
        text: { primary: '#e7f3fd', secondary: '#b3cbdc' },
        divider: '#354e62',
      },
    },
  },
  typography: {
    fontFamily:
      '"DM Sans", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif',
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: 0 },
    fontSize: 14,
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { variant: 'contained', disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 40,
          paddingInline: 16,
          borderRadius: 8,
          whiteSpace: 'nowrap',
        },
      },
    },
    MuiOutlinedInput: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { minWidth: 0, fontSize: '0.9375rem' } },
    },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiCheckbox: { defaultProps: { size: 'small' } },
    MuiTable: { defaultProps: { size: 'small' } },
    MuiTableCell: {
      styleOverrides: {
        root: { padding: '12px 14px' },
        head: ({ theme }) => ({
          fontWeight: 650,
          fontSize: '0.8125rem',
          letterSpacing: '0.025em',
          color: theme.vars.palette.text.secondary,
          backgroundColor: theme.vars.palette.background.default,
          whiteSpace: 'nowrap',
        }),
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiChip: { defaultProps: { size: 'small' } },
    MuiPaper: { defaultProps: { elevation: 0 } },
  },
})
