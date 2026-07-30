import { useEffect, useState } from 'react'

export function DesktopTitleBar() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const api = window.talkDesktop
    if (!api) return
    void api.isMaximized().then(setMaximized)
    return api.onMaximizedChange(setMaximized)
  }, [])

  return (
    <header className="desktop-titlebar">
      <div className="desktop-titlebar-brand">
        <img src="./app-icon.png" alt="" />
        <span>Talk</span>
      </div>
      <div className="desktop-titlebar-drag" />
      <div className="desktop-window-controls">
        <button type="button" onClick={() => window.talkDesktop?.minimize()} aria-label="最小化">—</button>
        <button type="button" onClick={() => window.talkDesktop?.toggleMaximize()} aria-label={maximized ? '还原' : '最大化'}>
          {maximized ? '❐' : '□'}
        </button>
        <button type="button" className="desktop-close" onClick={() => window.talkDesktop?.close()} aria-label="关闭">×</button>
      </div>
    </header>
  )
}
