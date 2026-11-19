import { createContext, use } from 'react'

export type MessageKind = 'success' | 'info' | 'warning' | 'error'
export const MessageContext = createContext<Record<
  MessageKind,
  (text: string) => () => void
> | null>(null)

export function useMessage() {
  const message = use(MessageContext)
  if (!message) throw new Error('MessageProvider is required')
  return message
}
