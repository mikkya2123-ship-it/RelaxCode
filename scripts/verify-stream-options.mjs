// Quick verification that stream_options.include_usage is added to the request body
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const agentPath = join(__dirname, '..', 'src', 'main', 'agent.ts')
const content = readFileSync(agentPath, 'utf-8')

// Check that stream_options with include_usage is present
const hasStreamOptions = content.includes('stream_options: { include_usage: true }')
const hasStreamTrue = content.includes('stream: true')

console.log('Checking agent.ts for stream_options fix...')
console.log('  stream: true present:', hasStreamTrue)
console.log('  stream_options: { include_usage: true } present:', hasStreamOptions)

if (hasStreamOptions) {
  console.log('\n✅ Fix verified: stream_options.include_usage is in the request body')
  process.exit(0)
} else {
  console.log('\n❌ Fix NOT found: stream_options.include_usage is missing')
  process.exit(1)
}
