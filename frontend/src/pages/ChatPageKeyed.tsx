import { useParams } from 'react-router'
import { ChatPage } from './ChatPage'

/** Keyed by id so switching conversations remounts the Flue session. */
export function ChatPageKeyed() {
  const { conversationId } = useParams()
  return <ChatPage key={conversationId} />
}
