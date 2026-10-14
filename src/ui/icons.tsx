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
}

export function Icon({ name }: { name: string }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={PATHS[name] ?? PATHS.more} /></svg>
}
