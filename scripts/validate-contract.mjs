import fs from 'node:fs'
import assert from 'node:assert/strict'
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.id, 'io.github.rui-pedro-silva.cloudflare-warp')
assert.equal(manifest.name, 'Cloudflare WARP')
assert.equal(manifest.version, '1.0.0')
assert.equal(manifest.author, 'Rui Silva')
assert.equal(manifest.license, 'MIT')
assert.deepEqual(manifest.kinds, ['bar-widget'])
assert.equal(manifest.entryPoints.barWidget, 'Panel.qml')
assert.equal(manifest.barWidget.category, 'Network')
assert.equal(manifest.barWidget.defaultSection, 'right')
assert.equal(manifest.barWidget.allowMultiple, false)
assert.equal(manifest.barWidget.defaults.refreshIntervalSec, 15)
assert.doesNotMatch(manifest.description, /privacy/i)
for (const file of ['Panel.qml','PanelConfirmDialog.qml','Service.qml','CloudIcon.qml','Model.js','README.md','AUDIT.md','LICENSE','preview.png','.github/workflows/ci.yml'])
  assert.ok(fs.existsSync(file), `${file} missing`)

const panel = fs.readFileSync('Panel.qml', 'utf8')
const service = fs.readFileSync('Service.qml', 'utf8')
const model = fs.readFileSync('Model.js', 'utf8')
const readme = fs.readFileSync('README.md', 'utf8')
const sources = [panel, service, model].join('\n')
assert.doesNotMatch(sources, /registration\s+delete|registration\s+remove|settings\s+reset|trusted\s+network|split\s+tunnel/i)
assert.doesNotMatch(sources, /(?:bash|sh)\s*,\s*["']-c["']/)
assert.doesNotMatch(panel, /#[0-9a-fA-F]{3,8}/)
assert.match(panel, /KeyboardPanel\s*\{/)
assert.match(panel, /PanelKeyCatcher\s*\{/)
assert.equal((panel.match(/\bDropdown\s*\{/g) || []).length, 3)
assert.match(service, /Model\.publicStatus/)
assert.doesNotMatch(service, /property string organization|effectiveConnected|_desiredConnected/)
for (const disclosure of [
  /does \*\*not officially support Arch Linux\*\*/i,
  /community-maintained.*AUR/i,
  /does \*\*not\*\* disconnect, unregister, disable, or uninstall/i,
  /unaffiliated/i,
  /does not provide anonymity/i,
  /2026\.6\.880\.0/
]) assert.match(readme, disclosure)
console.log('manifest and file contract valid')
