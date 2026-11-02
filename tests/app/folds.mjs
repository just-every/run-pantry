// A customer record opens with Records and closes every other section. These find a folded section by its name and open it in place.
export const fold = (page, name) => page.locator('details.fold').filter({ has: page.locator('summary > span:first-child', { hasText: new RegExp(`^${name}$`) }) })

export async function openFold(section) {
  if (!(await section.evaluate(el => el.open))) await section.locator('summary').first().click()
  return section
}
