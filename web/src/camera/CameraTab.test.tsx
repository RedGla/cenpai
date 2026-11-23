import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CameraTab from './CameraTab'

afterEach(cleanup)

it('words a missing camera for the user and reads as not protecting', () => {
  render(<CameraTab />)
  expect(screen.getByRole('alert')).toHaveTextContent(/camera is not available/i)
  expect(screen.getByTestId('shield')).toHaveTextContent('Not protecting')
})

it('keeps settings in a sheet with a way back to the start page', () => {
  const onAbout = vi.fn()
  render(<CameraTab onAbout={onAbout} />)
  const sheet = screen.getByTestId('settings')
  expect(sheet).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(sheet).toBeVisible()
  expect(screen.getByRole('button', { name: 'Benchmark' })).toBeInTheDocument()
  expect(screen.getByTestId('fps')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Record video' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'About CenpAI' }))
  expect(onAbout).toHaveBeenCalledOnce()
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
