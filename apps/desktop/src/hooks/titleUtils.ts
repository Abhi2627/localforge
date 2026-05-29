// Strips all markdown formatting from a string — used to clean model-generated titles
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '')        // **bold**
    .replace(/\*/g, '')          // *italic*
    .replace(/`/g, '')           // `code`
    .replace(/#{1,6}\s/g, '')    // ## headers
    .replace(/[_~]/g, '')        // _underline_ ~~strike~~
    .replace(/^["'`]+|["'`]+$/g, '') // surrounding quotes
    .replace(/[^\w\s]/g, ' ')    // any other non-word chars → space
    .replace(/\s+/g, ' ')        // collapse spaces
    .trim()
}

// Inserts spaces before capital letters in camelCase/PascalCase strings
export function spaceCamelCase(text: string): string {
  if (text.includes(' ')) return text
  return text.replace(/([A-Z])/g, ' $1').trim()
}

export function cleanTitle(raw: string, fallback: string): string {
  let t = stripMarkdown(raw)
  t = spaceCamelCase(t)
  t = t.slice(0, 50).trim()
  return t || fallback.slice(0, 40)
}
