import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api/resources'
import { isAiTestId } from '../lib/aiTestIsolation'

export function DesktopHomePage() {
  const navigate = useNavigate()
  const { data: conversations = [] } = useQuery({ queryKey: ['conversations'], queryFn: () => api.conversations.list() })
  const newestConversation = useMemo(
    () => conversations.filter((item) => !isAiTestId(item.id)).sort((a, b) => b.updatedAt - a.updatedAt)[0],
    [conversations],
  )
  useEffect(() => {
    if (newestConversation) void navigate(`/chat/${newestConversation.id}`, { replace: true })
  }, [navigate, newestConversation])
  return <div className="desktop-empty-pane"><div><img src="./app-icon.png" alt="" /><h2>Talk</h2><p>从左侧选择一个会话，或添加新的联系人。</p></div></div>
}
