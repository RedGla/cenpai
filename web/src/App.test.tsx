import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from './App'

it('shows only the Camera view', () => {
  render(<App />)
  expect(screen.getByTestId('camera-video')).toBeInTheDocument()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.queryByText(/bleep/i)).not.toBeInTheDocument()
})
