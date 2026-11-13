const { evaluate } = await import('./cdp.mjs')
console.log('ping', await evaluate('1+1'))
console.log('has api', await evaluate('typeof window.relaxcode?.mcp?.detect'))
process.exit(0)
