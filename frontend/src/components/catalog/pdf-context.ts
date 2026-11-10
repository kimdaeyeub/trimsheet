import { createContext } from 'react'

/** The vehicle's original PDF (served by the backend), so page references can open it. */
export const PdfUrlContext = createContext<string | null>(null)
