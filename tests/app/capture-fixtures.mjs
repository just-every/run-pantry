// Synthetic evidence only: two readable receipts on a desk, and a valid three-page PDF.
export async function receiptPhoto(page, number) {
  const bytes = await page.evaluate(number => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 720
    const c = canvas.getContext('2d')
    c.fillStyle = '#d7d9d7'; c.fillRect(0, 0, 1000, 720)
    for (const [x, title, total, items, tint] of [[70, 'CEDAR STATIONERY', '18.75', ['Sketch pad           12.00', 'Graphite pencils       6.75'], '#fffdf4'], [550, 'JUNIPER COFFEE', '9.50', ['Flat white             4.50', 'Morning pastry         5.00'], '#f0f8ff']]) {
      c.fillStyle = '#bec3c0'; c.fillRect(x + 8, 48, 380, 632)
      c.fillStyle = tint; c.fillRect(x, 40, 380, 632)
      c.fillStyle = '#26394c'; c.textAlign = 'center'; c.font = 'bold 25px monospace'; c.fillText(title, x + 190, 94)
      c.font = '16px monospace'; c.fillText('18 Cedar Lane', x + 190, 128); c.fillText('Brisbane QLD', x + 190, 153)
      c.textAlign = 'left'; c.font = '17px monospace'
      const lines = ['--------------------------------', 'RECEIPT / TAX INVOICE', `22 OCT 2026  Ref ${number}-${x}`, '--------------------------------', ...items, '', 'GST included', '--------------------------------', `TOTAL                    $${total}`, '', 'PAID / VISA ending 4821', 'Thank you for shopping locally', '', 'Keep this receipt for your records']
      lines.forEach((line, i) => c.fillText(line, x + 22, 204 + i * 28))
    }
    return Array.from(new Uint8Array(Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0))))
  }, number)
  return Buffer.from(bytes)
}

export function threePagePdf(number) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>']
  for (let page = 1; page <= 3; page++) {
    const stream = `BT /F1 20 Tf 60 720 Td (Synthetic Pantry ${number} - page ${page} of 3) Tj 0 -40 Td (Cedar Studio - supporting receipt document) Tj ET\n`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${page * 2 + 2} 0 R >>`, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let pdf = '%PDF-1.4\n', offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}
