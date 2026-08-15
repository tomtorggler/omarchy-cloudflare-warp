const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const M = require('../Model.js')

test('parses current status labels conservatively and never echoes diagnostics', () => {
  assert.deepEqual(M.parseStatus('Status update: Connected', '', 0), { state: 'connected', connected: true, error: '' })
  assert.equal(M.parseStatus('Status: Disconnected', '', 0).state, 'disconnected')
  assert.equal(M.parseStatus('Status update: Connecting', '', 0).state, 'connecting')
  assert.equal(M.parseStatus('Status update: Disconnecting', '', 0).state, 'connecting')
  assert.equal(M.parseStatus('Message: Status update: Connected', '', 0).state, 'unknown')
  assert.equal(M.parseStatus('Status update: Quantum flux', '', 0).connected, false)

  const sensitive = M.parseStatus('Status update: Unable: DNS Lookup Failed for secret.internal', '', 0)
  assert.deepEqual(sensitive, { state: 'error', connected: false, error: 'WARP reported a connection error' })
  assert.equal(JSON.stringify(sensitive).includes('secret.internal'), false)
  assert.equal(M.parseStatus('Status update: Unable: tunnel connection refused', '', 0).state, 'error')
})

test('distinguishes missing client, daemon, registration, network, malformed, and unknown states', () => {
  assert.equal(M.parseStatus('', 'env: warp-cli: No such file or directory', 127).state, 'missing-client')
  assert.equal(M.parseStatus('', 'Unable to connect to the CloudflareWARP daemon: No such file or directory (os error 2)\nMaybe the daemon is not running?', 1).state, 'daemon-down')
  assert.equal(M.parseStatus('', 'Missing registration due to: registration not found', 1).state, 'unregistered')
  const terms = 'Please accept the WARP Terms of Service by running this command in a TTY or by passing the --accept-tos flag.'
  assert.deepEqual(M.parseStatus('', terms, 1), {
    state: 'unregistered', connected: false, error: 'This device is not registered', termsRequired: true
  })
  assert.equal(M.termsRequired(terms), true)
  assert.equal(M.termsRequired(terms + ' unexpected'), false)
  assert.equal(M.parseStatus('Status update: Unable to connect: No Network', '', 0).state, 'no-network')
  assert.equal(M.parseStatus('Status update: Unable: NoNetwork', '', 0).state, 'no-network')
  assert.equal(M.parseStatus('Status update: Unable to connect: DNS failure', '', 0).state, 'error')
  assert.equal(M.parseStatus('not a status', '', 0).state, 'unknown')
  assert.equal(M.parseStatus('', 'opaque newer failure token=private', 4).error, 'WARP status command failed')
})

test('parses consumer, Team, managed, missing, and malformed registrations without retaining identifiers', () => {
  const consumer = M.parseRegistration('Account type: Free', '', 0)
  assert.deepEqual(consumer, { known: true, registered: true, managed: false })
  assert.equal(M.parseRegistration('Account type: NotManaged\nOrganization: <None>', '', 0).managed, false)

  const managed = M.parseRegistration('Account type: Team\nOrganization: Example Corp', '', 0)
  assert.deepEqual(managed, { known: true, registered: true, managed: true })
  assert.equal(JSON.stringify(managed).includes('Example Corp'), false)

  assert.deepEqual(M.parseRegistration('', 'Missing registration', 1), {
    known: true, registered: false, managed: false
  })
  assert.deepEqual(M.parseRegistration('', 'Please accept the WARP Terms of Service by running this command in a TTY or by passing the --accept-tos flag.', 1), {
    known: true, registered: false, managed: false, termsRequired: true
  })
  assert.deepEqual(M.parseRegistration('Account type: FutureTier', '', 0), {
    known: true, registered: true, managed: true
  })
  assert.deepEqual(M.parseRegistration('opaque newer success', '', 0), {
    known: false, registered: false, managed: false
  })
  assert.deepEqual(M.parseRegistration('', 'opaque failure', 1), {
    known: false, registered: false, managed: false
  })
})

test('parses source-prefixed current settings, organization preflight, and exact Switch Locked booleans', () => {
  const sample = [
    '(network policy) Mode: WarpWithDnsOverHttps',
    '(network policy) WARP tunnel protocol: WireGuard',
    '(default) Families mode: Malware + adult content',
    '(network policy) Switch Locked: false',
    '(default) Organization: <None>'
  ].join('\n')
  assert.deepEqual(M.parseSettings(sample, 0), {
    known: true,
    mode: 'warp+doh', protocol: 'WireGuard', families: 'full',
    lockedKnown: true, locked: false,
    organizationKnown: true, organizationConfigured: false
  })

  const locked = M.parseSettings('(policy) Switch Locked: true\n(default) Organization: Acme', 0)
  assert.equal(locked.lockedKnown, true)
  assert.equal(locked.locked, true)
  assert.equal(locked.organizationConfigured, true)
  assert.equal(JSON.stringify(locked).includes('Acme'), false)

  assert.equal(M.parseSettings('(user set) Mode: WarpProxy on port 40000', 0).mode, 'proxy')
  assert.equal(M.parseSettings('(default) Families mode: None', 0).families, 'off')
  assert.equal(M.parseSettings('Switch Locked: false', 7).known, false)
  assert.equal(M.parseSettings('Mode: FutureMode', 0).mode, 'unknown')
})

test('derives Families from exact current resolver endpoints with explicit-label precedence', () => {
  const fixture = resolver => [
    '(user set) Mode: Warp',
    '(default) WARP tunnel protocol: MASQUE',
    `(not set) Resolve via: ${resolver}`,
    '(default) Switch Locked: false'
  ].join('\n')

  assert.equal(M.parseSettings(fixture('cloudflare-dns.com @ [1.1.1.1]'), 0).families, 'off')
  assert.equal(M.parseSettings(fixture('one.one.one.one @ [1.1.1.1]'), 0).families, 'off')
  assert.equal(M.parseSettings(fixture('security.cloudflare-dns.com @ [1.1.1.2]'), 0).families, 'malware')
  assert.equal(M.parseSettings(fixture('family.cloudflare-dns.com @ [1.1.1.3]'), 0).families, 'full')
  assert.equal(M.parseSettings(fixture('custom.example @ [192.0.2.1]'), 0).families, 'unknown')
  assert.equal(M.parseSettings(fixture('cloudflare-dns.com.evil.example @ [192.0.2.1]'), 0).families, 'unknown')
  assert.equal(M.parseSettings(fixture('prefix-cloudflare-dns.com @ [192.0.2.1]'), 0).families, 'unknown')
  assert.equal(M.parseSettings(fixture('cloudflare-dns.com trailing text'), 0).families, 'unknown')

  const explicit = fixture('cloudflare-dns.com @ [1.1.1.1]')
    + '\n(user set) Families mode: Malware + adult content'
  assert.equal(M.parseSettings(explicit, 0).families, 'full')
  const explicitUnknown = fixture('cloudflare-dns.com @ [1.1.1.1]')
    + '\n(user set) Families mode: FutureProfile'
  assert.equal(M.parseSettings(explicitUnknown, 0).families, 'unknown')
})

test('normalizes every supported configuration enum', () => {
  const modes = {
    Warp: 'warp', DnsOverHttps: 'doh', WarpWithDnsOverHttps: 'warp+doh',
    DnsOverTls: 'dot', WarpWithDnsOverTls: 'warp+dot', LocalProxy: 'proxy',
    TrafficOnly: 'tunnel_only'
  }
  for (const [raw, expected] of Object.entries(modes)) assert.equal(M.normalizeMode(raw), expected)
  assert.equal(M.normalizeProtocol('MASQUE'), 'MASQUE')
  assert.equal(M.normalizeProtocol('wireguard'), 'WireGuard')
  assert.equal(M.normalizeFamilies('Malware and adult content'), 'full')
  assert.equal(M.normalizeFamilies('Malware + adult content'), 'full')
  assert.equal(M.normalizeFamilies('Block malware'), 'malware')
})

test('maps every command to a fixed argument array and rejects interpolation', () => {
  const prefix = ['env', 'LC_ALL=C', 'LANG=C', 'NO_COLOR=1', 'TERM=dumb', 'PAGER=cat', 'warp-cli', '--no-ansi', '--no-paginate']
  const acceptedPrefix = prefix.concat(['--accept-tos'])
  assert.deepEqual(M.command('status'), prefix.concat(['status']))
  assert.deepEqual(M.command('registration'), prefix.concat(['registration', 'show']))
  assert.deepEqual(M.command('settings'), prefix.concat(['settings', 'list']))
  assert.deepEqual(M.command('registration-preflight'), [
    'env', 'LC_ALL=C', 'LANG=C', 'NO_COLOR=1', 'TERM=dumb', 'PAGER=cat',
    'warp-cli', '--json', '--no-ansi', '--no-paginate', '--accept-tos', 'mdm', 'get-configs'
  ])
  assert.deepEqual(M.command('register'), acceptedPrefix.concat(['registration', 'new']))
  assert.deepEqual(M.command('status', '', true), acceptedPrefix.concat(['status']))
  assert.deepEqual(M.command('registration', '', true), acceptedPrefix.concat(['registration', 'show']))
  assert.deepEqual(M.command('settings', '', true), acceptedPrefix.concat(['settings', 'list']))
  assert.deepEqual(M.command('connect', '', true), acceptedPrefix.concat(['connect']))
  assert.deepEqual(M.command('disconnect', '', true), acceptedPrefix.concat(['disconnect']))
  assert.deepEqual(M.command('mode', 'warp', true), acceptedPrefix.concat(['mode', 'warp']))
  assert.deepEqual(M.command('protocol', 'MASQUE', true), acceptedPrefix.concat(['tunnel', 'protocol', 'set', 'MASQUE']))
  assert.deepEqual(M.command('families', 'off', true), acceptedPrefix.concat(['dns', 'families', 'off']))
  assert.deepEqual(M.command('status', '', 'true'), prefix.concat(['status']))
  for (const value of M.MODES) assert.deepEqual(M.command('mode', value).slice(-2), ['mode', value])
  for (const value of M.PROTOCOLS) assert.deepEqual(M.command('protocol', value).slice(-4), ['tunnel', 'protocol', 'set', value])
  for (const value of M.FAMILIES) assert.deepEqual(M.command('families', value).slice(-3), ['dns', 'families', value])
  assert.deepEqual(M.command('start-daemon'), ['pkexec', 'systemctl', 'enable', '--now', 'warp-svc.service'])
  assert.deepEqual(M.command('start-daemon', '', true), ['pkexec', 'systemctl', 'enable', '--now', 'warp-svc.service'])
  assert.deepEqual(M.command('mode', 'warp; rm -rf /'), [])
  assert.deepEqual(M.command('organization'), [])
  assert.equal(M.command('status').includes('-c'), false)
})

test('maps action failures by action kind and redacts the public IPC result', () => {
  assert.equal(M.actionError('mode', '', 'token=super-secret-value unexpected failure', 9), 'WARP command failed (exit 9)')
  assert.equal(M.actionError('connect', '', 'Operation NotAuthorized in this context', 1), 'Action is not allowed')
  assert.equal(M.actionError('start-daemon', '', 'Error: Not authorized', 1), 'Administrator authentication was canceled')
  const existing = 'Old registration is still around. Try running: "warp-cli registration delete" and re-run this command'
  assert.equal(M.registrationAlreadyExists('', existing, 1), true)
  assert.equal(M.actionError('register', '', existing, 1), 'WARP is already registered')
  assert.equal(M.registrationAlreadyExists('', 'Old registration is still around.', 1), true)
  assert.equal(M.registrationAlreadyExists('', existing + ' token=private', 1), false)
  assert.equal(M.registrationAlreadyExists('', 'unrelated Old registration is still around.', 1), false)
  assert.equal(M.registrationAlreadyExists('', existing, 0), false)
  assert.equal(M.publicError('Could not verify MDM configuration'), 'Could not verify MDM configuration')

  const status = M.publicStatus({
    state: 'malicious-secret-state', mode: 'warp;secret', protocol: 'private', families: 'token',
    error: 'token=super-secret host=secret.internal https://private.example', organization: 'Example Corp',
    termsAccepted: true
  })
  assert.deepEqual(status, {
    state: 'unknown', connected: false, mode: 'unknown', protocol: 'unknown', families: 'unknown',
    managed: false, locked: false, busy: false, error: 'WARP operation failed'
  })
  const serialized = JSON.stringify(status)
  assert.equal(serialized.includes('termsAccepted'), false)
  for (const secret of ['super-secret', 'secret.internal', 'private.example', 'Example Corp'])
    assert.equal(serialized.includes(secret), false)
})

test('transition reduction waits for the exact target and terminates real failures', () => {
  assert.deepEqual(M.transitionResult('connected', 'connected'), { done: true, success: true, error: '' })
  assert.deepEqual(M.transitionResult('disconnected', 'disconnected'), { done: true, success: true, error: '' })
  assert.equal(M.transitionResult('disconnected', 'connecting').done, false)
  assert.equal(M.transitionResult('disconnected', 'connected').done, false)
  assert.equal(M.transitionResult('connected', 'disconnected').done, false)
  assert.equal(M.transitionResult('connected', 'no-network').error, 'Network is unavailable')
  assert.equal(M.transitionResult('disconnected', 'daemon-down').done, true)
  assert.equal(M.transitionResult('connected', 'unknown').success, false)
})

test('capabilities distinguish managed settings, Switch Locked, and registration preflight', () => {
  const base = {
    state: 'connected', connected: true, registered: true, registrationKnown: true,
    settingsKnown: true, managed: false, locked: false, busy: false
  }
  assert.equal(M.capabilities(base).canDisconnect, true)
  assert.equal(M.capabilities({ ...base, locked: true }).canDisconnect, false)
  assert.equal(M.capabilities({ ...base, locked: true }).canConfigure, true)
  assert.equal(M.capabilities({ ...base, managed: true }).canConfigure, false)
  assert.equal(M.capabilities({ ...base, settingsKnown: false }).canConfigure, false)
  assert.equal(M.capabilities({ ...base, state: 'unknown', connected: false }).canConfigure, false)
  assert.equal(M.capabilities({ ...base, state: 'unknown', connected: false }).canConnect, false)
  assert.equal(M.capabilities({ ...base, busy: true }).canDisconnect, false)
  assert.equal(M.capabilities({ state: 'unregistered', consumerRegistrationAllowed: true }).canRegister, true)
  assert.equal(M.capabilities({ state: 'unregistered', termsRequired: true }).canRegister, true)
  assert.equal(M.capabilities({ state: 'unregistered', termsRequired: true, managed: true }).canRegister, false)
  assert.equal(M.capabilities({ state: 'unregistered', consumerRegistrationAllowed: false }).canRegister, false)
  assert.equal(M.capabilities({ state: 'daemon-down' }).canStartDaemon, true)

  assert.deepEqual(M.registrationPreflight({ known: true, organizationKnown: true, organizationConfigured: false }), {
    known: true, allowed: true, managed: false
  })
  assert.deepEqual(M.registrationPreflight({ known: true, organizationKnown: true, organizationConfigured: true }), {
    known: true, allowed: false, managed: true
  })
  assert.equal(M.registrationPreflight({ known: true, organizationKnown: false }).allowed, false)
  assert.deepEqual(M.registrationPreflight({ known: false, termsRequired: true }), {
    known: false, allowed: false, managed: false
  })
})

test('MDM registration preflight permits only the exact empty configuration shape', () => {
  assert.deepEqual(M.parseMdmPreflight('{"active":null,"available":[]}', '', 0), {
    known: true, allowed: true, managed: false
  })
  assert.deepEqual(M.parseMdmPreflight('{\n  "available": [],\n  "active": null\n}', '', 0), {
    known: true, allowed: true, managed: false
  })

  const active = M.parseMdmPreflight('{"active":{"organization":"private-org"},"available":[]}', '', 0)
  assert.deepEqual(active, { known: true, allowed: false, managed: true })
  assert.equal(JSON.stringify(active).includes('private-org'), false)
  assert.deepEqual(M.parseMdmPreflight('{"active":null,"available":[{"organization":"private-org"}]}', '', 0), {
    known: true, allowed: false, managed: true
  })

  for (const args of [
    ['{"active":null,"available":[]}', 'warning', 0],
    ['{"active":null,"available":[]}', '', 1],
    ['{"active":null,"available":[],"future":true}', '', 0],
    ['{"active":null,"available":{}}', '', 0],
    ['{"available":[]}', '', 0],
    ['not json', '', 0],
    ['null', '', 0],
    ['[]', '', 0]
  ]) assert.deepEqual(M.parseMdmPreflight(...args), {
    known: false, allowed: false, managed: false
  })
})

test('settings reduction preserves known-good values and fails configuration closed', () => {
  const current = { mode: 'warp', protocol: 'MASQUE', families: 'malware', locked: true, managed: true }
  assert.deepEqual(M.reduceSettings(current, { known: false }), {
    settingsKnown: false, mode: 'warp', protocol: 'MASQUE', families: 'malware', locked: true, managed: true
  })

  const parsed = M.parseSettings([
    '(user set) Mode: WarpWithDnsOverTls',
    '(user set) WARP tunnel protocol: MASQUE',
    '(user set) Families mode: Off',
    '(default) Switch Locked: false',
    '(default) Organization: <None>'
  ].join('\n'), 0)
  assert.deepEqual(M.reduceSettings({ mode: 'unknown', protocol: 'unknown', families: 'unknown' }, parsed), {
    settingsKnown: true, mode: 'warp+dot', protocol: 'MASQUE', families: 'off', locked: false, managed: false
  })
})

test('service serializes work, bounds time, coalesces refreshes, and polls transitions status-only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Service.qml'), 'utf8')
  assert.equal((source.match(/\bProcess\s*\{/g) || []).length, 2)
  assert.match(source, /function refresh\(details\)/)
  assert.match(source, /_refreshQueued/)
  assert.match(source, /Model\.transitionResult\(_transitionTarget, state\)/)
  assert.match(source, /onTriggered: root\.refresh\(false\)/)
  assert.match(source, /interval: 8000/)
  assert.match(source, /start-daemon" \? 120000/)
  assert.match(source, /_actionKind === "register" \? 60000 : 15000/)
  assert.match(source, /interval: 8000\n    onTriggered: root\.actionError = ""/)
  assert.match(source, /value === "proxy" && protocol !== "MASQUE"/)
  assert.match(source, /value === "WireGuard" && mode === "proxy"/)
  assert.match(source, /Model\.reduceSettings/)
  assert.match(source, /Model\.registrationPreflight/)
  assert.match(source, /Model\.parseMdmPreflight\(_actionOut, _actionErr, exitCode\)/)
  assert.match(source, /Model\.parseMdmPreflight\(_actionOut, _actionErr, exitCode\)[\s\S]{0,400}settingsKnown = false/)
  assert.match(source, /if \(termsRequired\) \{/)
  assert.match(source, /property bool _continuingAction/)
  assert.match(source, /property bool pollingPaused/)
  assert.match(source, /running: !root\.pollingPaused/)
  assert.match(source, /Component\.onCompleted: Qt\.callLater\(function\(\) \{ root\.refresh\(true\) \}\)/)
  assert.doesNotMatch(source, /onTermsAcceptedChanged/)
  assert.match(source, /readonly property bool termsAccepted: _sessionTermsAccepted[\s\S]{0,100}settings && settings\.termsAccepted === true/)
  const serviceCommandCalls = [...source.matchAll(/Model\.command\(([^)]*)\)/g)].map(match => match[1])
  assert.ok(serviceCommandCalls.length >= 3)
  for (const args of serviceCommandCalls) assert.match(args, /termsAccepted/)
  assert.match(source, /continueAction\("registration-check", "registration"\)/)
  assert.match(source, /existing\.known && !existing\.registered[\s\S]{0,160}continueAction\("register", "register"\)/)
  assert.match(source, /Model\.registrationAlreadyExists\(_actionOut, _actionErr, exitCode\)/)
  assert.doesNotMatch(source, /_desiredConnected|_generation|execDetached|shellQuote|["']-c["']/)
  assert.doesNotMatch(source, /property string organization/)
})

test('panel follows native theme, single-page, keyboard, scrolling, and binding patterns', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Panel.qml'), 'utf8')
  assert.equal((source.match(/\bKeyboardPanel\s*\{/g) || []).length, 1)
  assert.match(source, /PanelKeyCatcher\s*\{/)
  assert.match(source, /PanelConfirmDialog\s*\{/)
  assert.match(source, /Flickable\s*\{/)
  assert.equal((source.match(/\bDropdown\s*\{/g) || []).length, 3)
  assert.match(source, /onTabRequested: function\(direction\) \{ root\.switchPanel\(direction\) \}/)
  assert.match(source, /onTextKey: function\(text\)/)
  assert.match(source, /key === "t"/)
  assert.match(source, /key === "r"/)
  assert.match(source, /Qt\.binding\(function\(\) \{ return warp\.mode \}\)/)
  assert.match(source, /WARP \+ DoH · Traffic \+ DNS \(HTTPS\)/)
  assert.match(source, /root\.bar\.fontFamily/)
  assert.match(source, /Color\.popups\.background/)
  assert.match(source, /pollingPaused: root\.confirmAction !== ""/)
  assert.match(source, /entry\.termsAccepted = true/)
  assert.match(source, /updateEntryInline\(root\.moduleName, entry\)/)
  assert.match(source, /Qt\.callLater\(function\(\) \{ warp\.registerConsumer\(\) \}\)/)
  assert.match(source, /readonly property bool iconConnected: warp\.state === "connected" && warp\.connected/)
  assert.match(source, /readonly property color iconDim: Util\.alpha\(foreground, 0\.55\)/)
  assert.match(source, /readonly property bool iconPulse: warp\.state === "checking" \|\| warp\.state === "connecting" \|\| warp\.actionBusy/)
  assert.match(source, /readonly property string iconStatus: warp\.state === "checking" \|\| warp\.state === "connecting" \? "connecting"/)
  assert.match(source, /: \(iconUrgent \? "urgent" : \(iconConnected \? "connected" : "disconnected"\)\)/)
  assert.match(source, /if \(warp\.actionStatus !== ""\) return warp\.actionStatus\.replace/)
  const iconStateBindings = source.match(/readonly property string iconStatus:[\s\S]*?readonly property color barIconColor:[^\n]*/)[0]
  assert.doesNotMatch(iconStateBindings, /actionBusy|actionStatus|refreshing/)
  const iconPulseBinding = source.match(/readonly property bool iconPulse:[^\n]*/)[0]
  assert.doesNotMatch(iconPulseBinding, /refreshing/)
  assert.equal((source.match(/status: root\.iconStatus/g) || []).length, 2)
  assert.equal((source.match(/pulse: root\.iconPulse/g) || []).length, 2)
  assert.match(source, /BarIconButton\s*\{[\s\S]{0,100}anchors\.fill: parent/)
  assert.match(source, /Accessible\.role: Accessible\.Button/)
  assert.match(source, /Accessible\.name: "Cloudflare WARP, " \+ root\.heroMeta\(\)\.toLowerCase\(\)/)
  assert.match(source, /Accessible\.description: warp\.actionStatus !== ""/)
  assert.match(source, /Accessible\.onPressAction: root\.toggle\(\)/)
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}|effectiveConnected|SequentialAnimation on scale|\bdimmed:/)

  const icon = fs.readFileSync(path.join(__dirname, '..', 'CloudIcon.qml'), 'utf8')
  for (const state of ['connected', 'disconnected', 'connecting', 'urgent'])
    assert.match(icon, new RegExp(`"${state}"`))
  assert.match(icon, /property color dimColor: Util\.alpha\(indicatorColor, 0\.55\)/)
  assert.match(icon, /SequentialAnimation on opacity/)
  assert.match(icon, /property bool pulse: false/)
  assert.match(icon, /running: root\.pulse/)
  assert.match(icon, /text: root\.visualStatus === "connected" \? "✓" : "!"/)
  assert.match(icon, /visible: root\.visualStatus === "disconnected"/)
  assert.match(icon, /visible: root\.visualStatus === "connecting"/)
  assert.match(icon, /width: iconSize \* 1\.22/)
  assert.doesNotMatch(icon, /#[0-9a-fA-F]{3,8}/)

  const confirmation = fs.readFileSync(path.join(__dirname, '..', 'PanelConfirmDialog.qml'), 'utf8')
  assert.match(confirmation, /font\.pixelSize: Style\.font\.body\n/)
  assert.match(confirmation, /font\.pixelSize: Style\.font\.bodySmall/)
  assert.doesNotMatch(confirmation, /font\.pixelSize: Style\.font\.title/)
})
