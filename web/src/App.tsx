import { useState } from 'react'
import CameraTab from './camera/CameraTab'
import AudioTab from './audio/AudioTab'

type Tab = 'camera' | 'audio'

export default function App() {
  const [tab, setTab] = useState<Tab>('camera')
  return (
    <div className="app">
      <header>
        <h1>CenpAI</h1>
        <nav role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'camera'}
            onClick={() => setTab('camera')}
          >
            Camera
          </button>
          <button
            role="tab"
            aria-selected={tab === 'audio'}
            onClick={() => setTab('audio')}
          >
            Audio
          </button>
        </nav>
      </header>
      <main>{tab === 'camera' ? <CameraTab /> : <AudioTab />}</main>
    </div>
  )
}
