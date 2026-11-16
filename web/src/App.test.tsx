import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from './App'

it('shows the Camera tab first and switches to the Audio tab', () => {
  render(<App />)
  expect(screen.getByRole('tab', { name: 'Camera' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  expect(screen.getByTestId('camera-video')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Audio' }))
  expect(screen.getByText(/Audio bleep/)).toBeInTheDocument()
})
