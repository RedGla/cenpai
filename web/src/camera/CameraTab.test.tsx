import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import CameraTab from './CameraTab'

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

it('explains on first run that nothing leaves the phone, then starts', () => {
  render(<CameraTab />)
  const intro = screen.getByRole('dialog', { name: 'CenpAI' })
  expect(intro).toHaveTextContent(/Nothing leaves the phone/)
  fireEvent.click(screen.getByTestId('start'))
  expect(screen.queryByRole('dialog', { name: 'CenpAI' })).not.toBeInTheDocument()
  expect(window.localStorage.getItem('cenpai.intro.seen')).toBe('1')
  // jsdom has no camera: the failure is worded for the user and protection reads as off.
  expect(screen.getByRole('alert')).toHaveTextContent(/camera is not available/i)
  expect(screen.getByTestId('shield')).toHaveTextContent('Not protecting')
})

it('skips the note after the first run and keeps settings in a sheet', () => {
  window.localStorage.setItem('cenpai.intro.seen', '1')
  render(<CameraTab />)
  expect(screen.queryByTestId('start')).not.toBeInTheDocument()
  const sheet = screen.getByTestId('settings')
  expect(sheet).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(sheet).toBeVisible()
  expect(screen.getByRole('button', { name: 'Benchmark' })).toBeInTheDocument()
  expect(screen.getByTestId('fps')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Record video' })).toBeInTheDocument()
})

it('?video=1 shows the file picker instead of asking for the camera', () => {
  window.localStorage.setItem('cenpai.intro.seen', '1')
  window.history.replaceState(null, '', '/?video=1')
  try {
    render(<CameraTab />)
    expect(screen.getByTestId('video-file')).toBeInTheDocument()
    // No camera request in file mode, so jsdom's missing camera is not an error here.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  } finally {
    window.history.replaceState(null, '', '/')
  }
})
