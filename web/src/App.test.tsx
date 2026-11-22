import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { initialView } from './landing/route'

beforeEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})
afterEach(cleanup)

it('opens on the start page, then the camera, with no tabs or speech features', () => {
  render(<App />)
  expect(screen.getByTestId('landing')).toHaveTextContent(/Nothing leaves the phone/)
  // The camera is not started on the start page.
  expect(screen.queryByTestId('camera-video')).not.toBeInTheDocument()
  fireEvent.click(screen.getByTestId('open-camera'))
  expect(screen.getByTestId('camera-video')).toBeInTheDocument()
  expect(window.location.search).toBe('?camera')
  expect(window.localStorage.getItem('cenpai.intro.seen')).toBe('1')
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByText(/bleep/i)).not.toBeInTheDocument()
})

it('goes back to the start page from the settings sheet', () => {
  window.localStorage.setItem('cenpai.intro.seen', '1')
  render(<App />)
  expect(screen.getByTestId('camera-video')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'About CenpAI' }))
  expect(screen.getByTestId('landing')).toBeInTheDocument()
  expect(window.location.search).toBe('?about')
})

describe('initialView', () => {
  it('shows the start page on a first visit', () => {
    expect(initialView('', false)).toBe('landing')
  })
  it('goes to the camera once seen, or by address', () => {
    expect(initialView('', true)).toBe('camera')
    expect(initialView('?camera', false)).toBe('camera')
    expect(initialView('?debug=1', false)).toBe('camera')
  })
  it('always shows the start page for ?about', () => {
    expect(initialView('?about', true)).toBe('landing')
  })
})
