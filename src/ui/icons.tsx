// Line icons drawn on a 24px grid, stroked in the current text colour.
const PATHS: Record<string, string> = {
  book: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5c-.8 0-1.5.7-1.5 1.5V5.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5.7 1.5 1.5V5.5z',
  invoice: 'M6 3h9l3 3v15H6zM15 3v3h3M9 11h6M9 15h6',
  bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  check: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 9.8',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  agent: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  ok: 'M5 12.5l4.5 4.5L19 7.5',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  building: 'M5 21V5.5L13 3v18M13 9h6v12M3 21h18M8.5 8h1.5M8.5 12h1.5M8.5 16h1.5M16 13h.5M16 17h.5',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c1.6.8 2.7 2.6 3 5.2',
  camera: 'M4 8h3.5L9 5.5h6L16.5 8H20v11H4zM12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  receipt: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3',
}

export function Icon({ name }: { name: string }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={PATHS[name] ?? PATHS.more} /></svg>
}
